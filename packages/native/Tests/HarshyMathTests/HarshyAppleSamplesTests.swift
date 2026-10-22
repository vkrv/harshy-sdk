import CoreLocation
import XCTest
@testable import HarshyMath

final class HarshyAppleSamplesTests: XCTestCase {
  func testMapsLocationFieldsAndStampsTheCaptureTime() {
    let location = CLLocation(
      coordinate: CLLocationCoordinate2D(latitude: 59.43, longitude: 24.75),
      altitude: 12,
      horizontalAccuracy: 4,
      verticalAccuracy: 3,
      course: 90,
      speed: 13.5,
      timestamp: Date(timeIntervalSince1970: 42)
    )
    let sample = location.harshyLocationSample(tMs: 1_000)
    XCTAssertEqual(sample.t, 1_000)
    XCTAssertEqual(sample.lat, 59.43)
    XCTAssertEqual(sample.lon, 24.75)
    XCTAssertEqual(sample.altitudeM, 12)
    XCTAssertEqual(sample.speedMps, 13.5)
    XCTAssertEqual(sample.courseDeg, 90)
    XCTAssertEqual(sample.accuracyM, 4)
    XCTAssertEqual(sample.altitudeAccuracyM, 3)
    XCTAssertNil(sample.roadRmsMps2)
  }

  func testLeavesInvalidLocationFieldsNil() {
    let location = CLLocation(
      coordinate: CLLocationCoordinate2D(latitude: 59.43, longitude: 24.75),
      altitude: 12,
      horizontalAccuracy: -1,
      verticalAccuracy: -1,
      course: -1,
      speed: -1,
      timestamp: Date()
    )
    let sample = location.harshyLocationSample(tMs: 1_000)
    XCTAssertNil(sample.speedMps)
    XCTAssertNil(sample.courseDeg)
    XCTAssertNil(sample.accuracyM)
    XCTAssertNil(sample.altitudeAccuracyM)
  }

  func testImuSampleScalesCoreMotionUnitsToSiUnits() {
    let g = 9.80665
    let sample = harshyImuSample(
      tMs: 1_234,
      userAccelerationG: HarshyVec3(x: 0.1, y: 0.2, z: 0.3),
      gravityG: HarshyVec3(x: 0, y: 0, z: -1),
      rotationRateRadps: HarshyVec3(x: 0.5, y: 0.25, z: 0.125)
    )
    XCTAssertEqual(sample.t, 1_234)
    XCTAssertEqual(sample.accel.x, 0.1 * g, accuracy: 1e-9)
    XCTAssertEqual(sample.accel.y, 0.2 * g, accuracy: 1e-9)
    XCTAssertEqual(sample.accel.z, (0.3 - 1) * g, accuracy: 1e-9)
    XCTAssertEqual(sample.linearAccel?.z ?? 0, 0.3 * g, accuracy: 1e-9)
    XCTAssertEqual(sample.gravity?.z ?? 0, -g, accuracy: 1e-9)
    XCTAssertEqual(sample.gyro, HarshyVec3(x: 0.5, y: 0.25, z: 0.125))
    XCTAssertNil(sample.magnetometer)
    XCTAssertNil(sample.attitude)
    XCTAssertNil(sample.barometerHpa)
  }

  func testCaptureTimeSubtractsTheReadingAge() {
    XCTAssertEqual(harshyCaptureMs(nowMs: 10_000, ageSeconds: 2.5, maxAgeSeconds: 30), 7_500)
  }

  func testCaptureTimeIsNowForAZeroNegativeOrNonFiniteAge() {
    for age in [0.0, -0.4, .nan, .infinity] {
      XCTAssertEqual(harshyCaptureMs(nowMs: 10_000, ageSeconds: age, maxAgeSeconds: 30), 10_000)
    }
  }

  func testCaptureTimeIsNowWhenTheAgeIsBeyondTrust() {
    XCTAssertEqual(harshyCaptureMs(nowMs: 10_000, ageSeconds: 31, maxAgeSeconds: 30), 10_000)
    XCTAssertEqual(harshyCaptureMs(nowMs: 10_000, ageSeconds: 30, maxAgeSeconds: 30), -20_000)
  }
}
