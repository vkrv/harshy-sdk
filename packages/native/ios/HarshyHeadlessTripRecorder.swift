import CoreLocation
import CoreMotion
import Foundation

/// Runs one `HarshyTripAnalyzer` on its own queue for a host that owns location and the process
/// lifecycle: no `CLLocationManager`, no authorization prompts, no wake lock or idle-timer changes.
///
/// The recorder starts Core Motion device-motion updates at `capture.imuHz` and thins locations
/// offered through `offerLocation` to `capture.locationIntervalMs`. Every sample is stamped by `clock`;
/// use one recorder, and one clock, per trip. Listener callbacks run on the recorder queue. The
/// recorder holds its listener strongly until the session is finalized, so a listener that owns the
/// recorder forms a cycle until then. The host keeps the process alive while recording, for example
/// with its own background location session.
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
  private let motion = CMMotionManager()
  private let stateLock = NSLock()

  /// Both guarded by `stateLock`: read by `offerLocation` and `stop()` from any thread.
  private var started = false
  /// Set by `stop()`; refuses new work. Work already queued still runs until `shutdown()`.
  private var stopped = false

  /// The rest is touched only on `queue`.
  private var listener: Listener?
  private var analyzer: HarshyTripAnalyzer?
  /// Set by `shutdown()`; after it nothing reaches the analyzer or listener.
  private var finished = false

  public init(
    sessionId: String,
    listener: Listener,
    detector: HarshyDetectorConfig? = nil,
    capture: HarshyNativeStartOptions = HarshyNativeStartOptions(background: false),
    device: HarshyDeviceInfo = HarshyDeviceInfo.current,
    trigger: String = "manual",
    /// IMU ring size passed to `HarshyTripAnalyzer`; keep it small when raw IMU is not exported.
    maxImuSamples: Int? = nil,
    clock: HarshyClock = .monotonic()
  ) {
    self.sessionId = sessionId
    self.listener = listener
    self.detector = detector
    self.device = device
    self.trigger = trigger
    self.maxImuSamples = maxImuSamples
    self.clock = clock
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

  /// Starts sampling. Call once.
  public func start() {
    stateLock.lock()
    precondition(!started, "HarshyHeadlessTripRecorder already started")
    started = true
    // Enqueued under the lock so an offerLocation that sees `started` cannot queue ahead of this block.
    queue.async { [self] in
      let startedAtMs = clock.nowMs()
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
    stateLock.unlock()
  }

  /// Offers a platform location fix. Safe from any thread; ignored before `start()` and after `stop()`.
  public func offerLocation(_ location: CLLocation) {
    // Convert on the caller's thread so the fix is stamped when it was offered, not when it is processed.
    let sample = location.harshyLocationSample(tMs: clock.nowMs())
    stateLock.lock()
    defer { stateLock.unlock() }
    guard started, !stopped else { return }
    queue.async { [self] in
      guard !finished, throttle.accept(Int64(sample.t)) else { return }
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
    guard motion.isDeviceMotionAvailable else { return [] }
    motion.deviceMotionUpdateInterval = 1.0 / Double(capture.imuHz)
    motion.startDeviceMotionUpdates(using: .xArbitraryZVertical, to: motionQueue) { [weak self] data, error in
      self?.handleMotion(data, error: error)
    }
    return Self.sensors
  }

  /// Runs on `queue`, because `motionQueue` targets it.
  private func handleMotion(_ data: CMDeviceMotion?, error: Error?) {
    guard !finished, !isStopped else { return }
    if let error {
      fail(error)
      return
    }
    guard let data else { return }
    let sample = harshyImuSample(
      tMs: clock.nowMs(),
      userAccelerationG: HarshyVec3(data.userAcceleration),
      gravityG: HarshyVec3(data.gravity),
      rotationRateRadps: HarshyVec3(data.rotationRate)
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
    motion.stopDeviceMotionUpdates()
    if let current = analyzer {
      analyzer = nil
      listener?.harshyRecorder(self, didFinalize: current.finalize(endedAtMs: Double(clock.nowMs())))
    }
    listener = nil
  }
}

private extension HarshyVec3 {
  init(_ acceleration: CMAcceleration) {
    self.init(x: acceleration.x, y: acceleration.y, z: acceleration.z)
  }

  init(_ rotationRate: CMRotationRate) {
    self.init(x: rotationRate.x, y: rotationRate.y, z: rotationRate.z)
  }
}
