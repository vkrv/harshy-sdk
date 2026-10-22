import CoreLocation
import Foundation

/// Runs one `HarshyTripAnalyzer` on its own queue for a host that owns location and the process
/// lifecycle: no `CLLocationManager`, no authorization prompts, no wake lock or idle-timer changes.
///
/// The recorder starts device-motion updates at `capture.imuHz` (Core Motion, through `motion`) and
/// thins locations offered through `offerLocation` to `capture.locationIntervalMs`. Every sample is
/// stamped by `clock`, from the sensor's own timestamp (see `harshyCaptureMs`); use one recorder, and
/// one clock, per trip. Listener callbacks run on the recorder queue. The recorder holds its listener
/// strongly until the session is finalized, so a listener that owns the recorder forms a cycle until
/// then.
///
/// The host keeps the process alive while recording: `UIBackgroundModes: location` and an active
/// location session. Core Motion stops delivering once the app is suspended, so a host that only
/// monitors significant changes or regions gets GPS and no IMU.
public final class HarshyHeadlessTripRecorder {
  public protocol Listener: AnyObject {
    func harshyRecorder(_ recorder: HarshyHeadlessTripRecorder, didStartAt startedAtMs: Int64, sensors: [String])
    func harshyRecorder(_ recorder: HarshyHeadlessTripRecorder, didPush push: HarshyAnalyzerPush)
    /// The finalized session, after `stop()` or after a failure.
    func harshyRecorder(_ recorder: HarshyHeadlessTripRecorder, didFinalize session: HarshySessionExport)
    /// A failure in Core Motion. Recording stops and the session is finalized.
    func harshyRecorder(_ recorder: HarshyHeadlessTripRecorder, didFail error: Error)
  }

  private static let sensors = ["accel", "linear_accel", "gyro", "gravity"]
  /// A fix older than this has an untrustworthy timestamp (a wall clock set by hand), so it is stamped on arrival.
  private static let maxLocationAgeSeconds = 30.0
  private static let maxImuAgeSeconds = 1.0

  private let sessionId: String
  private let detector: HarshyDetectorConfig?
  private let device: HarshyDeviceInfo
  private let trigger: String
  private let maxImuSamples: Int?
  private let clock: HarshyClock
  // One clamped copy drives the sampling rate, the throttle and the exported settings, so they always agree.
  private let capture: HarshyNativeStartOptions
  private let throttle: HarshyLocationThrottle
  private let queue = DispatchQueue(label: "com.harshy.headless")
  private let motionQueue = OperationQueue()
  private let motion: HarshyMotionSource?
  private let stateLock = NSLock()

  /// All guarded by `stateLock`: read by `offerLocation` and `stop()` from any thread.
  private var started = false
  /// Set by `stop()`; refuses new work. Work already queued still runs until `shutdown()`.
  private var stopped = false
  private var startedAtMs: Int64 = 0
  private var lastLocationMs: Int64?

  /// The rest is touched only on `queue`.
  private var listener: Listener?
  private var analyzer: HarshyTripAnalyzer?
  /// Set by `shutdown()`; after it nothing reaches the analyzer or listener.
  private var finished = false
  private var lastImuMs: Int64?

  public init(
    sessionId: String,
    listener: Listener,
    detector: HarshyDetectorConfig? = nil,
    capture: HarshyNativeStartOptions = HarshyNativeStartOptions(background: false),
    device: HarshyDeviceInfo = HarshyDeviceInfo.current,
    trigger: String = "manual",
    /// IMU ring size passed to `HarshyTripAnalyzer`; keep it small when raw IMU is not exported.
    maxImuSamples: Int? = nil,
    clock: HarshyClock = .monotonic(),
    /// Nil gives GPS and no IMU, which is also what a non-iOS host gets by default.
    motion: HarshyMotionSource? = harshySystemMotionSource()
  ) {
    self.sessionId = sessionId
    self.listener = listener
    self.detector = detector
    self.device = device
    self.trigger = trigger
    self.maxImuSamples = maxImuSamples
    self.clock = clock
    self.motion = motion
    var clamped = capture
    clamped.imuHz = min(max(capture.imuHz, harshyImuHzRange.lowerBound), harshyImuHzRange.upperBound)
    clamped.locationIntervalMs = min(
      max(capture.locationIntervalMs, harshyLocationIntervalMsRange.lowerBound),
      harshyLocationIntervalMsRange.upperBound
    )
    self.capture = clamped
    throttle = HarshyLocationThrottle(intervalMs: clamped.locationIntervalMs)
    motionQueue.maxConcurrentOperationCount = 1
    motionQueue.underlyingQueue = queue
  }

  /// Starts sampling. Call once: a second call is ignored, and trips an `assertionFailure` in debug builds.
  public func start() {
    stateLock.lock()
    defer { stateLock.unlock() }
    guard !started else {
      assertionFailure("HarshyHeadlessTripRecorder already started")
      return
    }
    started = true
    // Taken here, not on the queue, so `offerLocation` can tell a fix from before the trip.
    let startedAtMs = clock.nowMs()
    self.startedAtMs = startedAtMs
    // Enqueued under the lock so an offerLocation that sees `started` cannot queue ahead of this block.
    queue.async { [self] in
      analyzer = HarshyTripAnalyzer(
        config: detector,
        sessionId: sessionId,
        startedAtMs: Double(startedAtMs),
        device: device,
        trigger: trigger,
        capture: capture,
        imuHz: capture.imuHz,
        maxImuSamples: maxImuSamples
      )
      // A stop() queued right behind start() still finds an analyzer to finalize, but no sensors to start.
      let sensors = isStopped ? [] : startMotion()
      listener?.harshyRecorder(self, didStartAt: startedAtMs, sensors: sensors)
    }
  }

  /// Offers a platform location fix. Safe from any thread; ignored before `start()` and after `stop()`.
  ///
  /// The fix is stamped from `location.timestamp`, so every fix of a `didUpdateLocations` batch keeps its
  /// own time. A fix from before `start()` is ignored.
  public func offerLocation(_ location: CLLocation) {
    stateLock.lock()
    defer { stateLock.unlock() }
    guard started, !stopped else { return }
    // Stamped under the lock, in call order, so the queue sees non-decreasing times.
    let capturedMs = harshyCaptureMs(
      nowMs: clock.nowMs(),
      ageSeconds: Date().timeIntervalSince(location.timestamp),
      maxAgeSeconds: Self.maxLocationAgeSeconds
    )
    guard capturedMs >= startedAtMs else { return }
    let tMs = max(capturedMs, lastLocationMs ?? capturedMs)
    lastLocationMs = tMs
    let sample = location.harshyLocationSample(tMs: tMs)
    queue.async { [self] in
      guard !finished, throttle.accept(tMs) else { return }
      if let push = analyzer?.pushLocation(sample) {
        listener?.harshyRecorder(self, didPush: push)
      }
    }
  }

  /// Stops sampling, finalizes the session on the recorder queue, and releases the listener.
  public func stop() {
    stateLock.lock()
    defer { stateLock.unlock() }
    guard started, !stopped else { return }
    stopped = true
    queue.async { [self] in shutdown() }
  }

  private var isStopped: Bool {
    stateLock.lock()
    defer { stateLock.unlock() }
    return stopped
  }

  private func startMotion() -> [String] {
    guard let motion, motion.isAvailable else { return [] }
    motion.start(intervalSeconds: 1.0 / Double(capture.imuHz), queue: motionQueue) { [weak self] reading, error in
      self?.handleMotion(reading, error: error)
    }
    return Self.sensors
  }

  /// Runs on `queue`, because `motionQueue` targets it.
  private func handleMotion(_ reading: HarshyMotionReading?, error: Error?) {
    guard !finished, !isStopped else { return }
    if let error {
      fail(error)
      return
    }
    guard let reading else { return }
    let capturedMs = harshyCaptureMs(
      nowMs: clock.nowMs(),
      ageSeconds: reading.ageSeconds,
      maxAgeSeconds: Self.maxImuAgeSeconds
    )
    let tMs = max(capturedMs, lastImuMs ?? capturedMs)
    lastImuMs = tMs
    let sample = harshyImuSample(
      tMs: tMs,
      userAccelerationG: reading.userAccelerationG,
      gravityG: reading.gravityG,
      rotationRateRadps: reading.rotationRateRadps
    )
    if let push = analyzer?.pushImu(sample) {
      listener?.harshyRecorder(self, didPush: push)
    }
  }

  private func fail(_ error: Error) {
    stateLock.lock()
    stopped = true
    stateLock.unlock()
    listener?.harshyRecorder(self, didFail: error)
    shutdown()
  }

  private func shutdown() {
    guard !finished else { return }
    finished = true
    motion?.stop()
    if let current = analyzer {
      analyzer = nil
      listener?.harshyRecorder(self, didFinalize: current.finalize(endedAtMs: Double(clock.nowMs())))
    }
    listener = nil
  }
}
