import Foundation

public protocol HarshyUploadAdapter: AnyObject {
  func upload(sessionJson: String)
}

public extension HarshySessionExport {
  /// The export as JSON-compatible values. Empty if the export holds a non-finite number; `toJSONString()` throws then.
  func toJSONObject() -> [String: Any] {
    harshyJSONObject(self)
  }

  func toJSONString() throws -> String {
    String(decoding: try JSONEncoder().encode(self), as: UTF8.self)
  }
}

extension HarshyDetectorConfig {
  func toJSONObject() -> [String: Any] {
    harshyJSONObject(self)
  }
}

private func harshyJSONObject(_ value: some Encodable) -> [String: Any] {
  guard let data = try? JSONEncoder().encode(value),
        let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
  else { return [:] }
  return object
}

// The format is shared with Kotlin and `@harshy/core`. Optionals are omitted when absent unless the format
// requires an explicit `null`; those are written with `encode`, the rest with `encodeIfPresent`.

extension HarshySessionExport: Encodable {
  private enum CodingKeys: String, CodingKey {
    case schemaVersion, sdkVersion, sessionId, startedAt, endedAt, config, location, imu, events, metrics, device
    case trigger, capture
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(schemaVersion, forKey: .schemaVersion)
    try container.encode(sdkVersion, forKey: .sdkVersion)
    try container.encode(sessionId, forKey: .sessionId)
    try container.encode(startedAt, forKey: .startedAt)
    try container.encode(endedAt, forKey: .endedAt)
    try container.encode(config, forKey: .config)
    try container.encode(location, forKey: .location)
    try container.encode(imu, forKey: .imu)
    try container.encode(events, forKey: .events)
    try container.encode(metrics, forKey: .metrics)
    try container.encode(device, forKey: .device)
    try container.encode(trigger, forKey: .trigger)
    try container.encodeIfPresent(capture, forKey: .capture)
  }
}

extension HarshyDeviceInfo: Encodable {
  private enum CodingKeys: String, CodingKey {
    case platform, model
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(platform, forKey: .platform)
    try container.encode(model, forKey: .model)
  }
}

extension HarshyLocationSample: Encodable {
  private enum CodingKeys: String, CodingKey {
    case t, lat, lon, altitudeM, speedMps, courseDeg, accuracyM, altitudeAccuracyM, roadRmsMps2, speedLimitMps
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(t, forKey: .t)
    try container.encode(lat, forKey: .lat)
    try container.encode(lon, forKey: .lon)
    try container.encode(speedMps, forKey: .speedMps)
    try container.encode(accuracyM, forKey: .accuracyM)
    try container.encodeIfPresent(altitudeM, forKey: .altitudeM)
    try container.encodeIfPresent(courseDeg, forKey: .courseDeg)
    try container.encodeIfPresent(altitudeAccuracyM, forKey: .altitudeAccuracyM)
    try container.encodeIfPresent(roadRmsMps2, forKey: .roadRmsMps2)
    try container.encodeIfPresent(speedLimitMps, forKey: .speedLimitMps)
  }
}

extension HarshyImuSample: Encodable {
  private enum CodingKeys: String, CodingKey {
    case t, accel, linearAccel, gyro, magnetometer, attitude, gravity, barometerHpa
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(t, forKey: .t)
    try container.encode(accel, forKey: .accel)
    try container.encode(linearAccel, forKey: .linearAccel)
    try container.encode(gyro, forKey: .gyro)
    try container.encode(magnetometer, forKey: .magnetometer)
    try container.encode(attitude, forKey: .attitude)
    try container.encode(gravity, forKey: .gravity)
    try container.encode(barometerHpa, forKey: .barometerHpa)
  }
}

extension HarshyDrivingEvent: Encodable {
  private enum CodingKeys: String, CodingKey {
    case id, type, t, endT, peak, severity, level, lat, lon, speedMps, speedLimitMps, overlaps, impactDirection
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(id, forKey: .id)
    try container.encode(type, forKey: .type)
    try container.encode(t, forKey: .t)
    try container.encode(peak, forKey: .peak)
    try container.encode(severity, forKey: .severity)
    try container.encode(level, forKey: .level)
    try container.encode(lat, forKey: .lat)
    try container.encode(lon, forKey: .lon)
    try container.encode(speedMps, forKey: .speedMps)
    try container.encode(overlaps, forKey: .overlaps)
    try container.encodeIfPresent(endT, forKey: .endT)
    try container.encodeIfPresent(impactDirection, forKey: .impactDirection)
    try container.encodeIfPresent(speedLimitMps, forKey: .speedLimitMps)
  }
}

extension HarshyTripMetrics: Encodable {
  private enum CodingKeys: String, CodingKey {
    case distanceM, durationMs, maxSpeedMps, avgSpeedMps, points, score, eventCounts
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(distanceM, forKey: .distanceM)
    try container.encode(durationMs, forKey: .durationMs)
    try container.encode(maxSpeedMps, forKey: .maxSpeedMps)
    try container.encode(avgSpeedMps, forKey: .avgSpeedMps)
    try container.encode(points, forKey: .points)
    try container.encode(score, forKey: .score)
    try container.encode(eventCounts, forKey: .eventCounts)
  }
}
