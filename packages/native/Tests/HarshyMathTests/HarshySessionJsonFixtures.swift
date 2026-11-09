import Foundation
@testable import HarshyMath

/// Sessions with every optional field present and with every optional field absent, built from values that are
/// exact in binary so the JSON text is stable.
enum HarshySessionJsonFixtures {
  static func full() -> HarshySessionExport {
    var config = HarshyDetectorConfig.default
    config.speedingMps = 27.5
    return HarshySessionExport(
      schemaVersion: 1,
      sdkVersion: 13,
      sessionId: "full-session",
      startedAt: "2026-10-28T10:00:00.000Z",
      endedAt: "2026-10-28T10:05:00.000Z",
      config: config,
      location: [
        HarshyLocationSample(
          t: 1_000, lat: 59.5, lon: 24.75, altitudeM: 12.5, speedMps: 13.25, courseDeg: 90.5, accuracyM: 4.5,
          altitudeAccuracyM: 3.5, roadRmsMps2: 0.75, speedLimitMps: 16.5
        ),
      ],
      imu: [
        HarshyImuSample(
          t: 1_000,
          accel: HarshyVec3(x: 0.5, y: -0.25, z: 9.75),
          linearAccel: HarshyVec3(x: 1.5, y: 2.5, z: 3.5),
          gyro: HarshyVec3(x: 0.125, y: 0.25, z: 0.5),
          magnetometer: HarshyVec3(x: 10.5, y: 20.5, z: 30.5),
          attitude: HarshyAttitude(pitch: 0.5, roll: 0.25, yaw: 0.125),
          gravity: HarshyVec3(x: 0, y: 0, z: 9.75),
          barometerHpa: 1_013.25
        ),
      ],
      events: [
        HarshyDrivingEvent(
          id: "e1", type: "harsh_brake", t: 2_000, endT: 2_500, peak: 4.5, severity: 1.5, level: "medium",
          lat: 59.5, lon: 24.75, speedMps: 13.25, overlaps: ["swerve"], impactDirection: "front",
          speedLimitMps: 16.5
        ),
      ],
      metrics: HarshyTripMetrics(
        distanceM: 1_234.5, durationMs: 300_000, maxSpeedMps: 20.5, avgSpeedMps: 10.25, points: 8, score: 92.5,
        eventCounts: ["harsh_brake": 1, "swerve": 0]
      ),
      device: HarshyDeviceInfo(platform: "ios", model: "iPhone17,3"),
      trigger: "auto",
      capture: HarshyNativeStartOptions(imuHz: 25, locationIntervalMs: 1_000, background: true, trigger: "auto")
    )
  }

  static func sparse() -> HarshySessionExport {
    HarshySessionExport(
      schemaVersion: 1,
      sdkVersion: 13,
      sessionId: "sparse-session",
      startedAt: "2026-10-28T10:00:00.000Z",
      endedAt: nil,
      config: .default,
      location: [HarshyLocationSample(t: 1_000, lat: 59.5, lon: 24.75)],
      imu: [HarshyImuSample(t: 1_000, accel: HarshyVec3(x: 0, y: 0, z: 9.75))],
      events: [
        HarshyDrivingEvent(
          id: "e2", type: "speeding", t: 2_000, peak: 1.5, severity: 0.5, level: "light", lat: nil, lon: nil,
          speedMps: nil
        ),
      ],
      metrics: HarshyTripMetrics(
        distanceM: 0, durationMs: 0, maxSpeedMps: nil, avgSpeedMps: nil, points: 0, score: 100, eventCounts: [:]
      ),
      device: HarshyDeviceInfo(platform: "ios", model: nil),
      trigger: "manual",
      capture: nil
    )
  }
}
