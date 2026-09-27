import XCTest
@testable import HarshyMath

final class HarshyTripAnalyzerTests: XCTestCase {
  private let gravityUp = HarshyVec3(x: 0, y: 0, z: 9.81)

  private var quiet: HarshyDetectorConfig {
    var config = HarshyDetectorConfig.default
    config.harshAccelMps2 = 50
    config.harshBrakeMps2 = 50
    config.harshCornerMps2 = 50
    return config
  }

  private func shift(
    _ lat: Double,
    _ lon: Double,
    bearingDeg: Double,
    distanceM: Double
  ) -> (lat: Double, lon: Double) {
    let earth = 6_371_000.0
    let heading = bearingDeg * .pi / 180
    let lat1 = lat * .pi / 180
    let lon1 = lon * .pi / 180
    let ang = distanceM / earth
    let lat2 = asin(sin(lat1) * cos(ang) + cos(lat1) * sin(ang) * cos(heading))
    let lon2 = lon1 + atan2(
      sin(heading) * sin(ang) * cos(lat1),
      cos(ang) - sin(lat1) * sin(lat2)
    )
    return (lat2 * 180 / .pi, lon2 * 180 / .pi)
  }

  private func at(
    _ t: Double,
    speedMps: Double,
    courseDeg: Double,
    lat: Double,
    lon: Double
  ) -> HarshyLocationSample {
    HarshyLocationSample(t: t, lat: lat, lon: lon, speedMps: speedMps, courseDeg: courseDeg, accuracyM: 4)
  }

  private func loc(_ t: Double, speedMps: Double, courseDeg: Double = 0) -> HarshyLocationSample {
    HarshyLocationSample(
      t: t,
      lat: 32,
      lon: 34 + t / 10_000_000,
      speedMps: speedMps,
      courseDeg: courseDeg,
      accuracyM: 5
    )
  }

  private func restImu(_ t: Double) -> HarshyImuSample {
    HarshyImuSample(t: t, accel: gravityUp, linearAccel: HarshyVec3(x: 0, y: 0, z: 0), gravity: gravityUp)
  }

  private func pulseImu(_ t: Double, linear: HarshyVec3) -> HarshyImuSample {
    HarshyImuSample(
      t: t,
      accel: HarshyVec3(x: linear.x + gravityUp.x, y: linear.y + gravityUp.y, z: linear.z + gravityUp.z),
      linearAccel: linear,
      gravity: gravityUp
    )
  }

  private func horizontalPulse(t0: Double, peak: Double = 40) -> [HarshyImuSample] {
    var samples: [HarshyImuSample] = []
    for i in 0..<4 {
      samples.append(pulseImu(t0 + Double(i * 40), linear: HarshyVec3(x: peak, y: 0, z: 0)))
    }
    samples.append(restImu(t0 + 160))
    return samples
  }

  func testImpactDirectionLabels() {
    XCTAssertEqual(harshyImpactDirectionLabel("front"), "Front")
    XCTAssertEqual(harshyImpactDirectionLabel(nil), "Direction unknown")
    let event = HarshyDrivingEvent(
      id: "x",
      type: harshyPossibleImpactType,
      t: 0,
      peak: 1,
      severity: 0,
      level: "light",
      lat: nil,
      lon: nil,
      speedMps: nil
    )
    XCTAssertTrue(harshyIsPossibleImpact(event))
  }

  func testEmitsFrontImpactAfterSpeedDrop() {
    var imu = [restImu(1800)]
    imu.append(contentsOf: horizontalPulse(t0: 3000))
    imu.append(restImu(4000))
    let session = harshyAnalyzeTrip(
      location: [loc(2000, speedMps: 15), loc(4500, speedMps: 5)],
      imu: imu,
      sessionId: "impact",
      startedAtMs: 0,
      endedAtMs: 5000,
      device: HarshyDeviceInfo(platform: "ios", model: "test"),
      config: quiet
    )
    let event = session.events.first { $0.type == harshyPossibleImpactType }
    XCTAssertEqual(event?.impactDirection, "front")
    XCTAssertEqual(session.metrics.eventCounts[harshyPossibleImpactType], 1)
    XCTAssertEqual(session.metrics.points, 0, accuracy: 0.001)
    XCTAssertEqual(session.metrics.score, 100, accuracy: 0.001)
  }

  func testIgnoresVerticalPothole() {
    let session = harshyAnalyzeTrip(
      location: [loc(2000, speedMps: 15), loc(4500, speedMps: 15)],
      imu: [
        restImu(1800),
        pulseImu(3000, linear: HarshyVec3(x: 0, y: 0, z: 40)),
        pulseImu(3040, linear: HarshyVec3(x: 0, y: 0, z: 40)),
        pulseImu(3080, linear: HarshyVec3(x: 0, y: 0, z: 40)),
        restImu(3120),
      ],
      sessionId: "pothole",
      startedAtMs: 0,
      endedAtMs: 5000,
      device: HarshyDeviceInfo(platform: "ios", model: "test"),
      config: quiet
    )
    XCTAssertFalse(session.events.contains { $0.type == harshyPossibleImpactType })
  }

  func testFlagsHarshBrakeFromGps() {
    let session = harshyAnalyzeTrip(
      location: [loc(2000, speedMps: 20), loc(3000, speedMps: 10)],
      imu: [],
      sessionId: "brake",
      startedAtMs: 0,
      endedAtMs: 4000,
      device: HarshyDeviceInfo(platform: "ios", model: "test")
    )
    XCTAssertTrue(session.events.contains { $0.type == harshyEventHarshBrake })
  }

  func testDoesNotSwerveFromHandheldGyroWhenStopped() {
    let twist = HarshyImuSample(
      t: 1100,
      accel: gravityUp,
      linearAccel: HarshyVec3(x: 0, y: 0, z: 0),
      gyro: HarshyVec3(x: 0, y: 0, z: 2),
      gravity: gravityUp
    )
    let session = harshyAnalyzeTrip(
      location: [loc(0, speedMps: 0, courseDeg: 0), loc(1000, speedMps: 0, courseDeg: 90)],
      imu: [twist],
      sessionId: "handheld",
      startedAtMs: 0,
      endedAtMs: 2000,
      device: HarshyDeviceInfo(platform: "ios", model: "test")
    )
    XCTAssertFalse(session.events.contains { $0.type == harshyEventSwerve })
  }

  func testEmitsGpsSwerveWhenMoving() {
    let start = (lat: 59.46, lon: 24.82)
    let mid = shift(start.lat, start.lon, bearingDeg: 0, distanceM: 6)
    let end = shift(mid.lat, mid.lon, bearingDeg: 26, distanceM: 6)
    let session = harshyAnalyzeTrip(
      location: [
        at(0, speedMps: 6, courseDeg: 0, lat: start.lat, lon: start.lon),
        at(1000, speedMps: 6, courseDeg: 0, lat: mid.lat, lon: mid.lon),
        at(2000, speedMps: 6, courseDeg: 26, lat: end.lat, lon: end.lon),
      ],
      imu: [],
      sessionId: "swerve",
      startedAtMs: 0,
      endedAtMs: 3000,
      device: HarshyDeviceInfo(platform: "ios", model: "test")
    )
    XCTAssertTrue(session.events.contains { $0.type == harshyEventSwerve })
    XCTAssertFalse(session.events.contains { $0.type == harshyEventHarshCorner })
  }

  func testIgnoresChipBearingOnAStraightRoad() {
    let start = (lat: 59.46078, lon: 24.81843)
    let mid = shift(start.lat, start.lon, bearingDeg: 240, distanceM: 3)
    let end = shift(mid.lat, mid.lon, bearingDeg: 244, distanceM: 4.4)
    let session = harshyAnalyzeTrip(
      location: [
        at(0, speedMps: 0, courseDeg: 240, lat: start.lat, lon: start.lon),
        at(1000, speedMps: 3.38, courseDeg: 240, lat: mid.lat, lon: mid.lon),
        at(2000, speedMps: 4.44, courseDeg: 28, lat: end.lat, lon: end.lon),
      ],
      imu: [],
      sessionId: "straight",
      startedAtMs: 0,
      endedAtMs: 3000,
      device: HarshyDeviceInfo(platform: "ios", model: "test")
    )
    XCTAssertFalse(session.events.contains { $0.type == harshyEventHarshCorner || $0.type == harshyEventSwerve })
  }

  func testEmitsPhoneHandheldWhenPickedUpWhileMoving() {
    let gravitySide = HarshyVec3(x: 9.81, y: 0, z: 0)
    var imu: [HarshyImuSample] = []
    var t = 0.0
    while t <= 2000 {
      imu.append(restImu(t))
      t += 40
    }
    for i in 0..<5 {
      imu.append(
        HarshyImuSample(
          t: 2500 + Double(i * 80),
          accel: gravitySide,
          linearAccel: HarshyVec3(x: 0, y: 0, z: 0),
          gyro: HarshyVec3(x: 0, y: 2, z: 0),
          gravity: gravitySide
        )
      )
    }
    imu.append(
      HarshyImuSample(
        t: 3200,
        accel: gravitySide,
        linearAccel: HarshyVec3(x: 0, y: 0, z: 0),
        gravity: gravitySide
      )
    )
    imu.append(restImu(4200))
    imu.append(restImu(4600))
    imu.append(restImu(5000))
    imu.append(restImu(5400))
    let session = harshyAnalyzeTrip(
      location: [
        loc(0, speedMps: 12),
        loc(2000, speedMps: 12),
        loc(4000, speedMps: 12),
        loc(6000, speedMps: 12),
      ],
      imu: imu,
      sessionId: "phone",
      startedAtMs: 0,
      endedAtMs: 6000,
      device: HarshyDeviceInfo(platform: "ios", model: "test"),
      config: quiet
    )
    let event = session.events.first { $0.type == harshyPhoneHandheldType }
    XCTAssertNotNil(event)
    XCTAssertTrue(harshyIsPhoneHandheld(event!))
    XCTAssertNotNil(event?.endT)
    XCTAssertEqual(session.metrics.eventCounts[harshyPhoneHandheldType], 1)
    XCTAssertEqual(session.metrics.points, 0, accuracy: 0.001)
    XCTAssertEqual(session.metrics.score, 100, accuracy: 0.001)
  }

  func testDropsGpsTeleportFromSession() {
    let analyzer = HarshyTripAnalyzer(
      config: quiet,
      sessionId: "teleport",
      startedAtMs: 0,
      device: HarshyDeviceInfo(platform: "ios", model: "test")
    )
    _ = analyzer.pushLocation(
      HarshyLocationSample(t: 0, lat: 59.44803481455892, lon: 24.862493975088, speedMps: 4.42)
    )
    _ = analyzer.pushLocation(
      HarshyLocationSample(t: 732, lat: 59.4395306, lon: 24.868772)
    )
    _ = analyzer.pushLocation(
      HarshyLocationSample(
        t: 1000,
        lat: 59.448089925572276,
        lon: 24.862447874620557,
        speedMps: 8.6,
        accuracyM: 5
      )
    )
    let session = analyzer.finalize(endedAtMs: 2000)
    XCTAssertEqual(session.location.count, 2)
    XCTAssertFalse(session.location.contains { $0.lat == 59.4395306 })
    XCTAssertLessThan(session.metrics.distanceM, 50)
  }

  func testDropsCoarseNetworkLikeFixWithoutSpeed() {
    let analyzer = HarshyTripAnalyzer(
      config: quiet,
      sessionId: "coarse",
      startedAtMs: 0,
      device: HarshyDeviceInfo(platform: "ios", model: "test")
    )
    _ = analyzer.pushLocation(loc(0, speedMps: 5))
    _ = analyzer.pushLocation(
      HarshyLocationSample(t: 500, lat: 59.4425032, lon: 24.8530124)
    )
    _ = analyzer.pushLocation(loc(1000, speedMps: 5.1))
    let session = analyzer.finalize(endedAtMs: 2000)
    XCTAssertEqual(session.location.count, 2)
    XCTAssertFalse(session.location.contains { $0.speedMps == nil })
  }

  func testKeepsAccurateGnssFixWithoutSpeed() {
    let analyzer = HarshyTripAnalyzer(
      config: quiet,
      sessionId: "gnss",
      startedAtMs: 0,
      device: HarshyDeviceInfo(platform: "ios", model: "test")
    )
    _ = analyzer.pushLocation(loc(0, speedMps: 5))
    _ = analyzer.pushLocation(
      HarshyLocationSample(
        t: 500,
        lat: 32,
        lon: 34 + 500 / 10_000_000,
        speedMps: nil,
        accuracyM: 8
      )
    )
    let session = analyzer.finalize(endedAtMs: 1000)
    XCTAssertEqual(session.location.count, 2)
    XCTAssertNotNil(session.location.last?.speedMps)
  }

  func testFillsLiveHeadingAndGForceWhenGnssOmitsBearing() {
    let analyzer = HarshyTripAnalyzer(
      config: HarshyDetectorConfig.default,
      sessionId: "fused-course",
      startedAtMs: 0,
      device: HarshyDeviceInfo(platform: "ios", model: "test")
    )
    let lonPerM = 1 / (111_320 * cos(32 * Double.pi / 180))
    func east(_ t: Double) -> HarshyLocationSample {
      HarshyLocationSample(
        t: t,
        lat: 32,
        lon: 34 + 8 * (t / 1000) * lonPerM,
        speedMps: 8,
        courseDeg: nil,
        accuracyM: 8
      )
    }
    var metrics = analyzer.pushLocation(east(0)).metrics
    var t = 4000.0
    while t <= 16_000 {
      metrics = analyzer.pushLocation(east(t)).metrics
      t += 4000
    }
    XCTAssertNotNil(metrics.headingDeg)
    XCTAssertGreaterThan(metrics.headingDeg ?? -1, 80)
    XCTAssertLessThan(metrics.headingDeg ?? 999, 100)
    XCTAssertNotNil(metrics.longitudinalAccelMps2)
    XCTAssertNotNil(metrics.lateralAccelMps2)
  }

  func testSpeedLeapNeedsTheNextFix() {
    let from = HarshyLocationSample(
      t: 1_790_411_003_947,
      lat: 59.4104282,
      lon: 24.6768128,
      speedMps: 0.72,
      accuracyM: 10.5
    )
    let leap = HarshyLocationSample(
      t: 1_790_411_004_118,
      lat: 59.4104768,
      lon: 24.676784,
      speedMps: 33.01,
      accuracyM: 15.9
    )
    let back = HarshyLocationSample(
      t: 1_790_411_004_676,
      lat: 59.4104289,
      lon: 24.6768066,
      speedMps: 0.64,
      accuracyM: 10.7
    )
    XCTAssertTrue(harshyIsPlausibleDriveStep(from, leap))
    XCTAssertTrue(harshyIsSuspiciousSpeedLeap(from, leap))
    XCTAssertFalse(harshySpeedLeapHolds(anchor: from, leap: leap, next: back))
    let kept = HarshyLocationSample(t: 1_790_411_004_947, lat: 59.4107, lon: 24.6768, speedMps: 33)
    let still = HarshyLocationSample(t: 1_790_411_005_947, lat: 59.41097, lon: 24.6768, speedMps: 32)
    XCTAssertTrue(harshySpeedLeapHolds(anchor: from, leap: kept, next: still))
  }

  func testSessionJsonIncludesTrigger() {
    let session = harshyAnalyzeTrip(
      location: [loc(0, speedMps: 5)],
      imu: [],
      sessionId: "auto-1",
      startedAtMs: 0,
      endedAtMs: 1000,
      device: HarshyDeviceInfo(platform: "ios", model: "test"),
      trigger: "auto"
    )
    XCTAssertEqual(session.trigger, "auto")
    XCTAssertEqual(harshyParseTripTrigger(session.trigger), "auto")
    XCTAssertEqual(session.toJSONObject()["trigger"] as? String, "auto")
  }

  func testRecordsOneGentleAccelThenWaits() {
    let analyzer = harshyCreateTripAnalyzer(
      config: nil,
      sessionId: "smooth",
      startedAtMs: 0,
      device: HarshyDeviceInfo(platform: "ios", model: "test")
    )
    for step in 0...6 {
      _ = analyzer.pushLocation(loc(Double(step) * 1000, speedMps: 10 + Double(step)))
    }
    let session = analyzer.finalize(endedAtMs: 7000)
    XCTAssertEqual(session.events.filter { $0.type == harshyEventSmoothAccel }.count, 1)
    XCTAssertEqual(session.metrics.points, 2, accuracy: 0.001)
    XCTAssertEqual(session.metrics.score, 100, accuracy: 0.001)
  }
}
