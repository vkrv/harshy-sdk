import XCTest
@testable import HarshyMath

final class HarshyRoadTests: XCTestCase {
  private let gravityUp = HarshyVec3(x: 0, y: 0, z: 9.81)

  private func loc(_ t: Double, speedMps: Double, roadRmsMps2: Double? = nil) -> HarshyLocationSample {
    HarshyLocationSample(
      t: t,
      lat: 32,
      lon: 34,
      speedMps: speedMps,
      courseDeg: 0,
      accuracyM: 5,
      roadRmsMps2: roadRmsMps2
    )
  }

  private func imu(_ t: Double, z: Double) -> HarshyImuSample {
    HarshyImuSample(
      t: t,
      accel: HarshyVec3(x: 0, y: 0, z: z + 9.81),
      linearAccel: HarshyVec3(x: 0, y: 0, z: z),
      gravity: gravityUp
    )
  }

  func testFillsRoadRmsFromImuWindow() {
    let started = 1_000.0
    let t = started + 4_000
    let assessed = harshyAssessRoad(
      location: [loc(t, speedMps: 10)],
      imu: [imu(t - 800, z: 2), imu(t - 400, z: 2), imu(t, z: 2)],
      startedAtMs: started,
      jerkSettleMs: 1_500,
      minSpeedMps: 2
    )
    XCTAssertEqual(assessed[0].roadRmsMps2 ?? -1, 2, accuracy: 1e-6)
  }

  func testKeepsNativeStampedRoadWhenImuEmpty() {
    let assessed = harshyAssessRoad(
      location: [loc(5_000, speedMps: 12, roadRmsMps2: 1.75)],
      imu: [],
      startedAtMs: 1_000,
      jerkSettleMs: 1_500,
      minSpeedMps: 2
    )
    XCTAssertEqual(assessed[0].roadRmsMps2 ?? -1, 1.75, accuracy: 1e-9)
  }

  func testPreservesExistingRoadWhenImuPresent() {
    let t = 5_000.0
    let assessed = harshyAssessRoad(
      location: [loc(t, speedMps: 12, roadRmsMps2: 1.1)],
      imu: [imu(t - 200, z: 4), imu(t, z: 4)],
      startedAtMs: 1_000,
      jerkSettleMs: 1_500,
      minSpeedMps: 2
    )
    XCTAssertEqual(assessed[0].roadRmsMps2 ?? -1, 1.1, accuracy: 1e-9)
  }

  func testSkipsSettleAndIdle() {
    let started = 1_000.0
    let assessed = harshyAssessRoad(
      location: [
        loc(started + 400, speedMps: 12),
        loc(started + 3_000, speedMps: 0.5),
        loc(started + 4_000, speedMps: 10),
      ],
      imu: [
        imu(started + 300, z: 5),
        imu(started + 2_800, z: 5),
        imu(started + 3_500, z: 2),
        imu(started + 4_000, z: 2),
      ],
      startedAtMs: started,
      jerkSettleMs: 1_500,
      minSpeedMps: 2
    )
    XCTAssertNil(assessed[0].roadRmsMps2)
    XCTAssertNil(assessed[1].roadRmsMps2)
    XCTAssertEqual(assessed[2].roadRmsMps2 ?? -1, 2, accuracy: 1e-6)
  }
}
