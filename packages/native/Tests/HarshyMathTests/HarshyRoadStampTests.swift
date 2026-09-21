import XCTest
@testable import HarshyMath

final class HarshyRoadStampTests: XCTestCase {
  func testStampsRmsFromRecentImuWindow() {
    let started: Double = 1_000_000
    let t = started + 5_000
    var imu: [[String: Any?]] = []
    for i in 0..<20 {
      imu.append([
        "t": t - 800 + Double(i * 40),
        "accel": ["x": 0.0, "y": 0.0, "z": 9.8] as [String: Any?],
        "linearAccel": ["x": 0.0, "y": 0.0, "z": 2.0] as [String: Any?],
        "gravity": ["x": 0.0, "y": 0.0, "z": 9.8] as [String: Any?],
      ])
    }
    let sample: [String: Any?] = [
      "t": t,
      "lat": 59.0,
      "lon": 24.0,
      "speedMps": 10.0,
    ]
    let stamped = HarshyRoadStamp.withRoadRms(sample, startedAtMs: started, imu: imu)
    let rms = stamped["roadRmsMps2"] as? Double
    XCTAssertNotNil(rms)
    XCTAssertEqual(rms!, 2.0, accuracy: 1e-6)
  }

  func testSkipsIdleAndSettle() {
    let started: Double = 1_000_000
    let imu: [[String: Any?]] = [[
      "t": started + 200,
      "accel": ["x": 0.0, "y": 0.0, "z": 9.8] as [String: Any?],
      "linearAccel": ["x": 0.0, "y": 0.0, "z": 3.0] as [String: Any?],
      "gravity": ["x": 0.0, "y": 0.0, "z": 9.8] as [String: Any?],
    ]]
    let settling = HarshyRoadStamp.withRoadRms(
      ["t": started + 200, "speedMps": 10.0],
      startedAtMs: started,
      imu: imu
    )
    XCTAssertNil(settling["roadRmsMps2"] as? Double)

    let idle = HarshyRoadStamp.withRoadRms(
      ["t": started + 5_000, "speedMps": 0.5],
      startedAtMs: started,
      imu: imu
    )
    XCTAssertNil(idle["roadRmsMps2"] as? Double)
  }

  func testPreservesExistingRoadRms() {
    let stamped = HarshyRoadStamp.withRoadRms(
      ["t": 2_000_000.0, "speedMps": 10.0, "roadRmsMps2": 1.25],
      startedAtMs: 1_000_000,
      imu: []
    )
    XCTAssertEqual(stamped["roadRmsMps2"] as? Double ?? -1, 1.25, accuracy: 1e-9)
  }

  func testIgnoresImuOutsideOneSecondWindow() {
    let started: Double = 1_000_000
    let t = started + 5_000
    let imu: [[String: Any?]] = [
      [
        "t": t - 2_000,
        "linearAccel": ["x": 0.0, "y": 0.0, "z": 9.0] as [String: Any?],
        "accel": ["x": 0.0, "y": 0.0, "z": 18.8] as [String: Any?],
        "gravity": ["x": 0.0, "y": 0.0, "z": 9.8] as [String: Any?],
      ],
      [
        "t": t - 200,
        "linearAccel": ["x": 0.0, "y": 0.0, "z": 1.5] as [String: Any?],
        "accel": ["x": 0.0, "y": 0.0, "z": 11.3] as [String: Any?],
        "gravity": ["x": 0.0, "y": 0.0, "z": 9.8] as [String: Any?],
      ],
    ]
    let stamped = HarshyRoadStamp.withRoadRms(
      ["t": t, "speedMps": 10.0],
      startedAtMs: started,
      imu: imu
    )
    XCTAssertEqual(stamped["roadRmsMps2"] as? Double ?? -1, 1.5, accuracy: 1e-6)
  }
}
