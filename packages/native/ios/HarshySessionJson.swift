import Foundation

public protocol HarshyUploadAdapter: AnyObject {
  func upload(sessionJson: String)
}

public extension HarshySessionExport {
  func toJSONObject() -> [String: Any] {
    [
      "schemaVersion": schemaVersion,
      "sessionId": sessionId,
      "startedAt": startedAt,
      "endedAt": endedAt ?? NSNull(),
      "config": config.toJSONObject(),
      "location": location.map { $0.toJSONObject() },
      "imu": imu.map { $0.toJSONObject() },
      "events": events.map { $0.toJSONObject() },
      "metrics": metrics.toJSONObject(),
      "device": [
        "platform": device.platform,
        "model": device.model ?? NSNull(),
      ] as [String: Any],
      "trigger": trigger,
    ]
  }

  func toJSONString() throws -> String {
    let data = try JSONSerialization.data(withJSONObject: toJSONObject(), options: [])
    return String(data: data, encoding: .utf8) ?? "{}"
  }
}

extension HarshyDetectorConfig {
  func toJSONObject() -> [String: Any] {
    [
      "harshAccelMps2": harshAccelMps2,
      "harshBrakeMps2": harshBrakeMps2,
      "harshCornerMps2": harshCornerMps2,
      "harshMediumX": harshMediumX,
      "harshHeavyX": harshHeavyX,
      "harshSwerveRadps": harshSwerveRadps,
      "speedingMps": speedingMps ?? NSNull(),
      "speedingExitX": speedingExitX,
      "minSpeedMps": minSpeedMps,
      "cooldownMs": cooldownMs,
      "compoundWindowMs": compoundWindowMs,
      "jerkSettleMs": jerkSettleMs,
      "gpsAccelWindowMs": gpsAccelWindowMs,
      "maxLocationAccuracyM": maxLocationAccuracyM,
      "impactFloorMps2": impactFloorMps2,
      "impactPeakMps2": impactPeakMps2,
      "impactPeakHighMps2": impactPeakHighMps2,
      "impactPulseMaxMs": impactPulseMaxMs,
      "impactSpeedDeltaMps": impactSpeedDeltaMps,
      "impactLookaheadMs": impactLookaheadMs,
      "impactCooldownMs": impactCooldownMs,
      "impactVerticalMax": impactVerticalMax,
      "impactFreeFallMps2": impactFreeFallMps2,
      "impactFreeFallLookbackMs": impactFreeFallLookbackMs,
      "impactRolloverDeg": impactRolloverDeg,
      "handheldTiltDeg": handheldTiltDeg,
      "handheldExitTiltDeg": handheldExitTiltDeg,
      "handheldGyroRadps": handheldGyroRadps,
      "handheldMotionMps2": handheldMotionMps2,
      "handheldQuietGyroRadps": handheldQuietGyroRadps,
      "handheldQuietMotionMps2": handheldQuietMotionMps2,
      "handheldStableMs": handheldStableMs,
      "handheldConfirmMs": handheldConfirmMs,
      "handheldExitMs": handheldExitMs,
      "handheldCooldownMs": handheldCooldownMs,
      "handheldBaselineAlpha": handheldBaselineAlpha,
      "score": [
        "start": score.start,
        "harshAccel": score.harshAccel,
        "harshBrake": score.harshBrake,
        "harshCorner": score.harshCorner,
        "swerve": score.swerve,
        "speeding": score.speeding,
        "jerk": score.jerk,
        "compound": score.compound,
        "refDistanceKm": score.refDistanceKm,
        "refDurationMin": score.refDurationMin,
        "minDistanceKm": score.minDistanceKm,
        "minDurationMin": score.minDurationMin,
      ],
    ]
  }
}

extension HarshyLocationSample {
  func toJSONObject() -> [String: Any] {
    [
      "t": t,
      "lat": lat,
      "lon": lon,
      "altitudeM": altitudeM ?? NSNull(),
      "speedMps": speedMps ?? NSNull(),
      "courseDeg": courseDeg ?? NSNull(),
      "accuracyM": accuracyM ?? NSNull(),
      "altitudeAccuracyM": altitudeAccuracyM ?? NSNull(),
      "roadRmsMps2": roadRmsMps2 ?? NSNull(),
    ]
  }
}

extension HarshyImuSample {
  func toJSONObject() -> [String: Any] {
    [
      "t": t,
      "accel": accel.toJSONObject(),
      "linearAccel": linearAccel?.toJSONObject() ?? NSNull(),
      "gyro": gyro?.toJSONObject() ?? NSNull(),
      "magnetometer": magnetometer?.toJSONObject() ?? NSNull(),
      "attitude": attitude.map { ["pitch": $0.pitch, "roll": $0.roll, "yaw": $0.yaw] } ?? NSNull(),
      "gravity": gravity?.toJSONObject() ?? NSNull(),
      "barometerHpa": barometerHpa ?? NSNull(),
    ]
  }
}

extension HarshyVec3 {
  func toJSONObject() -> [String: Any] {
    ["x": x, "y": y, "z": z]
  }
}

extension HarshyDrivingEvent {
  func toJSONObject() -> [String: Any] {
    var json: [String: Any] = [
      "id": id,
      "type": type,
      "t": t,
      "endT": endT ?? NSNull(),
      "peak": peak,
      "severity": severity,
      "level": level,
      "lat": lat ?? NSNull(),
      "lon": lon ?? NSNull(),
      "speedMps": speedMps ?? NSNull(),
      "overlaps": overlaps,
    ]
    if let impactDirection {
      json["impactDirection"] = impactDirection
    }
    return json
  }
}

extension HarshyTripMetrics {
  func toJSONObject() -> [String: Any] {
    [
      "distanceM": distanceM,
      "durationMs": durationMs,
      "maxSpeedMps": maxSpeedMps ?? NSNull(),
      "avgSpeedMps": avgSpeedMps ?? NSNull(),
      "score": score,
      "eventCounts": eventCounts,
    ]
  }
}
