import XCTest
@testable import HarshyMath

final class HarshySampleMapsTests: XCTestCase {
  func testParsesLocationWithNumericTypes() {
    let sample = harshyParseLocationSample([
      "t": 1_500,
      "lat": 59.437,
      "lon": 24.753,
      "speedMps": "8.5",
      "accuracyM": 5,
      "roadRmsMps2": 1.25,
    ])
    XCTAssertNotNil(sample)
    XCTAssertEqual(sample!.t, 1500, accuracy: 0.001)
    XCTAssertEqual(sample!.lon, 24.753, accuracy: 0.001)
    XCTAssertEqual(sample!.speedMps ?? -1, 8.5, accuracy: 0.001)
    XCTAssertEqual(sample!.roadRmsMps2 ?? -1, 1.25, accuracy: 1e-9)
  }

  func testDropsLocationWithoutCoordinates() {
    XCTAssertNil(harshyParseLocationSample(["t": 1.0, "lat": 59.0]))
    XCTAssertNil(harshyParseLocationSample(["lat": 59.0, "lon": 24.0]))
  }

  func testParsesImuAccelAndOptionalGyro() {
    let sample = harshyParseImuSample([
      "t": 40.0,
      "accel": ["x": 0, "y": 0, "z": 9.81],
      "gyro": ["x": 0.1, "y": 0.0, "z": -0.2],
    ])
    XCTAssertNotNil(sample)
    XCTAssertEqual(sample!.accel.z, 9.81, accuracy: 0.001)
    XCTAssertEqual(sample!.gyro?.z ?? 0, -0.2, accuracy: 0.001)
  }

  func testDropsImuWithoutAccel() {
    XCTAssertNil(harshyParseImuSample(["t": 1.0, "gyro": ["x": 1, "y": 0, "z": 0]]))
  }

  func testParseTripTriggerKeepsAuto() {
    XCTAssertEqual(harshyParseTripTrigger("auto"), "auto")
    XCTAssertEqual(harshyParseTripTrigger("watch"), "manual")
    XCTAssertEqual(harshyParseTripTrigger(nil), "manual")
  }

  func testWatchKinematicActivityIgnoresWalkingAtVehicleSpeed() {
    XCTAssertEqual(harshyWatchKinematicActivity("walking", speedMps: 12), "unknown")
    XCTAssertEqual(harshyWatchKinematicActivity("walking", speedMps: 10.0 / 3.6), "unknown")
    XCTAssertEqual(harshyWatchKinematicActivity("walking", speedMps: 1), "walking")
    XCTAssertEqual(harshyWatchKinematicActivity("walking", speedMps: 10.0 / 3.6 - 0.1), "walking")
    XCTAssertEqual(harshyWatchKinematicActivity("cycling", speedMps: 12), "cycling")
  }

  func testAccurateGnssWithoutSpeedIsNotCoarse() {
    let gnss = HarshyLocationSample(
      t: 500,
      lat: 59.4425032,
      lon: 24.8530124,
      speedMps: nil,
      accuracyM: 8
    )
    XCTAssertFalse(harshyIsCoarseNetworkLikeFix(gnss))
    XCTAssertTrue(harshyShouldAcceptDriveFix(anchor: nil, sample: gnss, consecutiveRejects: 0).accept)
  }
}
