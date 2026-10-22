import CoreLocation
import XCTest
@testable import HarshyMath

private final class FakeMotionSource: HarshyMotionSource {
  var isAvailable = true
  private let lock = NSLock()
  private var handler: ((HarshyMotionReading?, Error?) -> Void)?
  private var queue: OperationQueue?
  private var stoppedFlag = false

  var stopped: Bool { lock.withLock { stoppedFlag } }

  func start(intervalSeconds: Double, queue: OperationQueue, handler: @escaping (HarshyMotionReading?, Error?) -> Void) {
    lock.withLock {
      self.queue = queue
      self.handler = handler
    }
  }

  func stop() {
    lock.withLock { stoppedFlag = true }
  }

  /// Delivers on the recorder's motion queue, as Core Motion does.
  func deliver(_ reading: HarshyMotionReading?, error: Error? = nil) {
    let (queue, handler) = lock.withLock { (self.queue, self.handler) }
    queue?.addOperation { handler?(reading, error) }
  }
}

private final class FakeClock {
  private let lock = NSLock()
  private var ms: Int64
  init(_ ms: Int64) { self.ms = ms }
  var nowMs: Int64 {
    get { lock.withLock { ms } }
    set { lock.withLock { ms = newValue } }
  }
  var clock: HarshyClock { HarshyClock { self.nowMs } }
}

private final class RecordingListener: HarshyHeadlessTripRecorder.Listener {
  let started = XCTestExpectation(description: "started")
  let pushed = XCTestExpectation(description: "pushed")
  let finalized = XCTestExpectation(description: "finalized")
  let failed = XCTestExpectation(description: "failed")
  private let lock = NSLock()
  private var startedSensors: [[String]] = []
  private var sessions: [HarshySessionExport] = []
  private var failures: [Error] = []
  private var order: [String] = []

  var sensors: [[String]] { lock.withLock { startedSensors } }
  var finalizedSessions: [HarshySessionExport] { lock.withLock { sessions } }
  var errors: [Error] { lock.withLock { failures } }
  var callbackOrder: [String] { lock.withLock { order } }

  func harshyRecorder(_ recorder: HarshyHeadlessTripRecorder, didStartAt startedAtMs: Int64, sensors: [String]) {
    lock.withLock {
      startedSensors.append(sensors)
      order.append("start")
    }
    started.fulfill()
  }

  func harshyRecorder(_ recorder: HarshyHeadlessTripRecorder, didPush push: HarshyAnalyzerPush) {
    pushed.fulfill()
  }

  func harshyRecorder(_ recorder: HarshyHeadlessTripRecorder, didFinalize session: HarshySessionExport) {
    lock.withLock {
      sessions.append(session)
      order.append("finalize")
    }
    finalized.fulfill()
  }

  func harshyRecorder(_ recorder: HarshyHeadlessTripRecorder, didFail error: Error) {
    lock.withLock {
      failures.append(error)
      order.append("fail")
    }
    failed.fulfill()
  }
}

private struct MotionFailure: Error {}

final class HarshyHeadlessTripRecorderTests: XCTestCase {
  private let startMs: Int64 = 1_000_000

  private func reading(ageSeconds: Double = 0) -> HarshyMotionReading {
    HarshyMotionReading(
      ageSeconds: ageSeconds,
      userAccelerationG: HarshyVec3(x: 0, y: 0, z: 0.1),
      gravityG: HarshyVec3(x: 0, y: 0, z: -1),
      rotationRateRadps: HarshyVec3(x: 0, y: 0, z: 0)
    )
  }

  private func fix(secondsAgo: Double, step: Int = 0) -> CLLocation {
    CLLocation(
      coordinate: CLLocationCoordinate2D(latitude: 59.43 + Double(step) * 1e-4, longitude: 24.75),
      altitude: 10,
      horizontalAccuracy: 5,
      verticalAccuracy: 5,
      course: 90,
      speed: 10,
      timestamp: Date(timeIntervalSinceNow: -secondsAgo)
    )
  }

  /// Starts a recorder on a fake clock and waits for `didStart`, then moves the clock on by `advanceMs`.
  private func startedRecorder(
    advanceMs: Int64 = 0,
    motion: FakeMotionSource = FakeMotionSource()
  ) -> (HarshyHeadlessTripRecorder, RecordingListener, FakeMotionSource, FakeClock) {
    let clock = FakeClock(startMs)
    let listener = RecordingListener()
    let recorder = HarshyHeadlessTripRecorder(
      sessionId: "s",
      listener: listener,
      capture: HarshyNativeStartOptions(background: false),
      device: HarshyDeviceInfo(platform: "ios"),
      clock: clock.clock,
      motion: motion
    )
    recorder.start()
    wait(for: [listener.started], timeout: 2)
    clock.nowMs = startMs + advanceMs
    return (recorder, listener, motion, clock)
  }

  func testReportsTheSensorsItStarted() {
    let (recorder, listener, _, _) = startedRecorder()
    recorder.stop()
    wait(for: [listener.finalized], timeout: 2)
    XCTAssertEqual(listener.sensors, [["accel", "linear_accel", "gyro", "gravity"]])
  }

  func testReportsNoSensorsWhenDeviceMotionIsUnavailable() {
    let motion = FakeMotionSource()
    motion.isAvailable = false
    let (recorder, listener, _, _) = startedRecorder(motion: motion)
    recorder.stop()
    wait(for: [listener.finalized], timeout: 2)
    XCTAssertEqual(listener.sensors, [[]])
  }

  func testKeepsEachFixOfABatchOwnTimeSoTheThrottleKeepsThemAll() {
    let (recorder, listener, _, _) = startedRecorder(advanceMs: 10_000)
    // One didUpdateLocations batch: three fixes a second apart, all offered at once.
    for (step, secondsAgo) in [2.0, 1.0, 0.0].enumerated() {
      recorder.offerLocation(fix(secondsAgo: secondsAgo, step: step))
    }
    recorder.stop()
    wait(for: [listener.finalized], timeout: 2)
    let times = listener.finalizedSessions.first?.location.map(\.t) ?? []
    XCTAssertEqual(times.count, 3)
    XCTAssertEqual(times[1] - times[0], 1_000, accuracy: 100)
    XCTAssertEqual(times[2] - times[1], 1_000, accuracy: 100)
    XCTAssertEqual(times[2], Double(startMs + 10_000), accuracy: 100)
  }

  func testIgnoresAFixFromBeforeTheTrip() {
    let (recorder, listener, _, _) = startedRecorder()
    recorder.offerLocation(fix(secondsAgo: 5))
    recorder.stop()
    wait(for: [listener.finalized], timeout: 2)
    XCTAssertEqual(listener.finalizedSessions.first?.location.count, 0)
  }

  func testStampsAFixWithATimestampFarInThePastOnArrival() {
    let (recorder, listener, _, _) = startedRecorder(advanceMs: 10_000)
    // A timestamp minutes off means the wall clock is wrong, not that the fix is old.
    recorder.offerLocation(fix(secondsAgo: 600))
    recorder.stop()
    wait(for: [listener.finalized], timeout: 2)
    XCTAssertEqual(listener.finalizedSessions.first?.location.first?.t ?? 0, Double(startMs + 10_000), accuracy: 1)
  }

  func testIgnoresFixesAfterStop() {
    let (recorder, listener, _, _) = startedRecorder(advanceMs: 10_000)
    recorder.stop()
    recorder.offerLocation(fix(secondsAgo: 0))
    wait(for: [listener.finalized], timeout: 2)
    XCTAssertEqual(listener.finalizedSessions.first?.location.count, 0)
  }

  func testStampsAnImuSampleWithItsAge() {
    let (recorder, listener, motion, _) = startedRecorder(advanceMs: 1_000_000)
    motion.deliver(reading(ageSeconds: 0.2))
    wait(for: [listener.pushed], timeout: 2)
    recorder.stop()
    wait(for: [listener.finalized], timeout: 2)
    XCTAssertEqual(listener.finalizedSessions.first?.imu.map(\.t), [Double(startMs + 1_000_000 - 200)])
  }

  func testImuTimesNeverGoBackwards() {
    let (recorder, listener, motion, _) = startedRecorder(advanceMs: 1_000_000)
    listener.pushed.expectedFulfillmentCount = 2
    motion.deliver(reading(ageSeconds: 0))
    motion.deliver(reading(ageSeconds: 0.3))
    wait(for: [listener.pushed], timeout: 2)
    recorder.stop()
    wait(for: [listener.finalized], timeout: 2)
    let times = listener.finalizedSessions.first?.imu.map(\.t) ?? []
    XCTAssertEqual(times, [Double(startMs + 1_000_000), Double(startMs + 1_000_000)])
  }

  func testStopFinalizesOnceAndStopsTheMotionSource() {
    let (recorder, listener, motion, _) = startedRecorder()
    recorder.stop()
    recorder.stop()
    wait(for: [listener.finalized], timeout: 2)
    XCTAssertEqual(listener.finalizedSessions.count, 1)
    XCTAssertTrue(motion.stopped)
  }

  func testAStopRightBehindStartStillFinalizes() {
    let clock = FakeClock(startMs)
    let listener = RecordingListener()
    let recorder = HarshyHeadlessTripRecorder(
      sessionId: "s",
      listener: listener,
      device: HarshyDeviceInfo(platform: "ios"),
      clock: clock.clock,
      motion: FakeMotionSource()
    )
    recorder.start()
    recorder.stop()
    wait(for: [listener.started, listener.finalized], timeout: 2, enforceOrder: true)
    XCTAssertEqual(listener.finalizedSessions.count, 1)
  }

  func testAMotionFailureReportsTheErrorThenFinalizes() {
    let (recorder, listener, motion, _) = startedRecorder()
    motion.deliver(nil, error: MotionFailure())
    wait(for: [listener.failed, listener.finalized], timeout: 2, enforceOrder: true)
    withExtendedLifetime(recorder) {}
    XCTAssertEqual(listener.errors.count, 1)
    XCTAssertEqual(listener.callbackOrder, ["start", "fail", "finalize"])
    XCTAssertTrue(motion.stopped)
  }
}
