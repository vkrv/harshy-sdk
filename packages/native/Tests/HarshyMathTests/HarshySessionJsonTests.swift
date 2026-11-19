import Foundation
import XCTest
@testable import HarshyMath

/// Pins the exported session JSON. The expected text was produced by the hand-written dictionary serializer that
/// preceded the `Encodable` one, so these tests prove the format did not change (Kotlin and `@harshy/core` read it).
final class HarshySessionJsonTests: XCTestCase {
  private let fullJSON = #"""
{"capture":{"background":true,"imuHz":25,"locationIntervalMs":1000,"trigger":"auto"},"config":{"compoundWindowMs":3500,"cooldownMs":4500,"gpsAccelWindowMs":1000,"handheldBaselineAlpha":0.080000000000000002,"handheldConfirmMs":350,"handheldCooldownMs":2500,"handheldExitMs":700,"handheldExitTiltDeg":18,"handheldGyroRadps":1.2,"handheldMotionMps2":2,"handheldQuietGyroRadps":0.25,"handheldQuietMotionMps2":0.80000000000000004,"handheldStableMs":800,"handheldTiltDeg":35,"harshAccelMps2":2.5,"harshBrakeMps2":3,"harshCornerMps2":3,"harshHeavyX":2,"harshMediumX":1.5,"harshSwerveJerkRadps2":0.40000000000000002,"harshSwerveRadps":0.45000000000000001,"impactCooldownMs":5000,"impactFloorMps2":15,"impactFreeFallLookbackMs":400,"impactFreeFallMps2":3,"impactLookaheadMs":2000,"impactPeakHighMps2":59,"impactPeakMps2":35,"impactPulseMaxMs":400,"impactRolloverDeg":50,"impactSpeedDeltaMps":4,"impactVerticalMax":0.71999999999999997,"jerkSettleMs":1500,"maxLocationAccuracyM":40,"minSpeedMps":2,"score":{"compound":3,"harshAccel":6,"harshBrake":8,"harshCorner":6,"jerk":3,"minDistanceKm":2,"minDurationMin":5,"refDistanceKm":5,"refDurationMin":10,"smoothAccel":1.6000000000000001,"smoothBrake":1.6000000000000001,"smoothCorner":1.6000000000000001,"speeding":4,"start":100,"swerve":5},"speedingExitX":0.94999999999999996,"speedingMps":27.5,"swerveMaxElevatedMs":2000,"swerveMinSpeedMps":5},"device":{"model":"iPhone17,3","platform":"ios"},"endedAt":"2026-10-28T10:05:00.000Z","events":[{"endT":2500,"id":"e1","impactDirection":"front","lat":59.5,"level":"medium","lon":24.75,"overlaps":["swerve"],"peak":4.5,"severity":1.5,"speedLimitMps":16.5,"speedMps":13.25,"t":2000,"type":"harsh_brake"}],"imu":[{"accel":{"x":0.5,"y":-0.25,"z":9.75},"attitude":{"pitch":0.5,"roll":0.25,"yaw":0.125},"barometerHpa":1013.25,"gravity":{"x":0,"y":0,"z":9.75},"gyro":{"x":0.125,"y":0.25,"z":0.5},"linearAccel":{"x":1.5,"y":2.5,"z":3.5},"magnetometer":{"x":10.5,"y":20.5,"z":30.5},"t":1000}],"location":[{"accuracyM":4.5,"altitudeAccuracyM":3.5,"altitudeM":12.5,"courseDeg":90.5,"lat":59.5,"lon":24.75,"roadRmsMps2":0.75,"speedLimitMps":16.5,"speedMps":13.25,"t":1000}],"metrics":{"avgSpeedMps":10.25,"distanceM":1234.5,"durationMs":300000,"eventCounts":{"harsh_brake":1,"swerve":0},"maxSpeedMps":20.5,"points":8,"score":92.5},"schemaVersion":1,"sdkVersion":13,"sessionId":"full-session","startedAt":"2026-10-28T10:00:00.000Z","trigger":"auto"}
"""#

  private let sparseJSON = #"""
{"config":{"compoundWindowMs":3500,"cooldownMs":4500,"gpsAccelWindowMs":1000,"handheldBaselineAlpha":0.080000000000000002,"handheldConfirmMs":350,"handheldCooldownMs":2500,"handheldExitMs":700,"handheldExitTiltDeg":18,"handheldGyroRadps":1.2,"handheldMotionMps2":2,"handheldQuietGyroRadps":0.25,"handheldQuietMotionMps2":0.80000000000000004,"handheldStableMs":800,"handheldTiltDeg":35,"harshAccelMps2":2.5,"harshBrakeMps2":3,"harshCornerMps2":3,"harshHeavyX":2,"harshMediumX":1.5,"harshSwerveJerkRadps2":0.40000000000000002,"harshSwerveRadps":0.45000000000000001,"impactCooldownMs":5000,"impactFloorMps2":15,"impactFreeFallLookbackMs":400,"impactFreeFallMps2":3,"impactLookaheadMs":2000,"impactPeakHighMps2":59,"impactPeakMps2":35,"impactPulseMaxMs":400,"impactRolloverDeg":50,"impactSpeedDeltaMps":4,"impactVerticalMax":0.71999999999999997,"jerkSettleMs":1500,"maxLocationAccuracyM":40,"minSpeedMps":2,"score":{"compound":3,"harshAccel":6,"harshBrake":8,"harshCorner":6,"jerk":3,"minDistanceKm":2,"minDurationMin":5,"refDistanceKm":5,"refDurationMin":10,"smoothAccel":1.6000000000000001,"smoothBrake":1.6000000000000001,"smoothCorner":1.6000000000000001,"speeding":4,"start":100,"swerve":5},"speedingExitX":0.94999999999999996,"swerveMaxElevatedMs":2000,"swerveMinSpeedMps":5},"device":{"model":null,"platform":"ios"},"endedAt":null,"events":[{"id":"e2","lat":null,"level":"light","lon":null,"overlaps":[],"peak":1.5,"severity":0.5,"speedMps":null,"t":2000,"type":"speeding"}],"imu":[{"accel":{"x":0,"y":0,"z":9.75},"attitude":null,"barometerHpa":null,"gravity":null,"gyro":null,"linearAccel":null,"magnetometer":null,"t":1000}],"location":[{"accuracyM":null,"lat":59.5,"lon":24.75,"speedMps":null,"t":1000}],"metrics":{"avgSpeedMps":null,"distanceM":0,"durationMs":0,"eventCounts":{},"maxSpeedMps":null,"points":0,"score":100},"schemaVersion":1,"sdkVersion":13,"sessionId":"sparse-session","startedAt":"2026-10-28T10:00:00.000Z","trigger":"manual"}
"""#

  func testFullSessionMatchesTheFrozenFormat() throws {
    try assertSameJSON(HarshySessionJsonFixtures.full(), fullJSON)
  }

  func testSparseSessionKeepsExplicitNullsAndOmitsAbsentKeys() throws {
    try assertSameJSON(HarshySessionJsonFixtures.sparse(), sparseJSON)
  }

  func testJSONObjectMatchesTheString() throws {
    let session = HarshySessionJsonFixtures.full()
    let fromString = try parse(session.toJSONString())
    XCTAssertTrue(NSDictionary(dictionary: session.toJSONObject()).isEqual(to: fromString))
  }

  private func assertSameJSON(_ session: HarshySessionExport, _ expected: String) throws {
    let actual = try parse(session.toJSONString())
    let frozen = try parse(expected)
    XCTAssertTrue(
      NSDictionary(dictionary: actual).isEqual(to: frozen),
      "exported JSON differs from the frozen format:\n\(actual)\nvs\n\(frozen)"
    )
  }

  private func parse(_ text: String) throws -> [String: Any] {
    try XCTUnwrap(JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any])
  }
}
