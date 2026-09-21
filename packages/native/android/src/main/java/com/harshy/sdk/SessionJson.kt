package com.harshy.sdk

import org.json.JSONArray
import org.json.JSONObject

fun interface UploadAdapter {
  fun upload(sessionJson: String)
}

fun SessionExport.toJson(): String = toJsonObject().toString()

fun SessionExport.toJsonObject(): JSONObject {
  val json = JSONObject()
  json.put("schemaVersion", schemaVersion)
  json.put("sessionId", sessionId)
  json.put("startedAt", startedAt)
  json.put("endedAt", endedAt ?: JSONObject.NULL)
  json.put("config", config.toJsonObject())
  json.put("location", JSONArray().also { array ->
    location.forEach { array.put(it.toJsonObject()) }
  })
  json.put("imu", JSONArray().also { array ->
    imu.forEach { array.put(it.toJsonObject()) }
  })
  json.put("events", JSONArray().also { array ->
    events.forEach { array.put(it.toJsonObject()) }
  })
  json.put("metrics", metrics.toJsonObject())
  json.put("device", JSONObject()
    .put("platform", device.platform)
    .put("model", device.model ?: JSONObject.NULL),
  )
  json.put("trigger", trigger)
  return json
}

private fun DetectorConfig.toJsonObject(): JSONObject {
  return JSONObject()
    .put("harshAccelMps2", harshAccelMps2)
    .put("harshBrakeMps2", harshBrakeMps2)
    .put("harshCornerMps2", harshCornerMps2)
    .put("harshMediumX", harshMediumX)
    .put("harshHeavyX", harshHeavyX)
    .put("harshSwerveRadps", harshSwerveRadps)
    .put("speedingMps", speedingMps ?: JSONObject.NULL)
    .put("speedingExitX", speedingExitX)
    .put("minSpeedMps", minSpeedMps)
    .put("cooldownMs", cooldownMs)
    .put("compoundWindowMs", compoundWindowMs)
    .put("jerkSettleMs", jerkSettleMs)
    .put("gpsAccelWindowMs", gpsAccelWindowMs)
    .put("maxLocationAccuracyM", maxLocationAccuracyM)
    .put("impactFloorMps2", impactFloorMps2)
    .put("impactPeakMps2", impactPeakMps2)
    .put("impactPeakHighMps2", impactPeakHighMps2)
    .put("impactPulseMaxMs", impactPulseMaxMs)
    .put("impactSpeedDeltaMps", impactSpeedDeltaMps)
    .put("impactLookaheadMs", impactLookaheadMs)
    .put("impactCooldownMs", impactCooldownMs)
    .put("impactVerticalMax", impactVerticalMax)
    .put("impactFreeFallMps2", impactFreeFallMps2)
    .put("impactFreeFallLookbackMs", impactFreeFallLookbackMs)
    .put("impactRolloverDeg", impactRolloverDeg)
    .put("handheldTiltDeg", handheldTiltDeg)
    .put("handheldExitTiltDeg", handheldExitTiltDeg)
    .put("handheldGyroRadps", handheldGyroRadps)
    .put("handheldMotionMps2", handheldMotionMps2)
    .put("handheldQuietGyroRadps", handheldQuietGyroRadps)
    .put("handheldQuietMotionMps2", handheldQuietMotionMps2)
    .put("handheldStableMs", handheldStableMs)
    .put("handheldConfirmMs", handheldConfirmMs)
    .put("handheldExitMs", handheldExitMs)
    .put("handheldCooldownMs", handheldCooldownMs)
    .put("handheldBaselineAlpha", handheldBaselineAlpha)
    .put(
      "score",
      JSONObject()
        .put("start", score.start)
        .put("harshAccel", score.harshAccel)
        .put("harshBrake", score.harshBrake)
        .put("harshCorner", score.harshCorner)
        .put("swerve", score.swerve)
        .put("speeding", score.speeding)
        .put("jerk", score.jerk)
        .put("compound", score.compound)
        .put("refDistanceKm", score.refDistanceKm)
        .put("refDurationMin", score.refDurationMin)
        .put("minDistanceKm", score.minDistanceKm)
        .put("minDurationMin", score.minDurationMin),
    )
}

private fun LocationSample.toJsonObject(): JSONObject {
  return JSONObject()
    .put("t", t)
    .put("lat", lat)
    .put("lon", lon)
    .put("altitudeM", altitudeM ?: JSONObject.NULL)
    .put("speedMps", speedMps ?: JSONObject.NULL)
    .put("courseDeg", courseDeg ?: JSONObject.NULL)
    .put("accuracyM", accuracyM ?: JSONObject.NULL)
    .put("altitudeAccuracyM", altitudeAccuracyM ?: JSONObject.NULL)
    .put("roadRmsMps2", roadRmsMps2 ?: JSONObject.NULL)
}

private fun ImuSample.toJsonObject(): JSONObject {
  return JSONObject()
    .put("t", t)
    .put("accel", accel.toJsonObject())
    .put("linearAccel", linearAccel?.toJsonObject() ?: JSONObject.NULL)
    .put("gyro", gyro?.toJsonObject() ?: JSONObject.NULL)
    .put("magnetometer", magnetometer?.toJsonObject() ?: JSONObject.NULL)
    .put("attitude", attitude?.let {
      JSONObject().put("pitch", it.pitch).put("roll", it.roll).put("yaw", it.yaw)
    } ?: JSONObject.NULL)
    .put("gravity", gravity?.toJsonObject() ?: JSONObject.NULL)
    .put("barometerHpa", barometerHpa ?: JSONObject.NULL)
}

private fun Vec3.toJsonObject(): JSONObject {
  return JSONObject().put("x", x).put("y", y).put("z", z)
}

private fun DrivingEvent.toJsonObject(): JSONObject {
  val json = JSONObject()
    .put("id", id)
    .put("type", type)
    .put("t", t)
    .put("endT", endT ?: JSONObject.NULL)
    .put("peak", peak)
    .put("severity", severity)
    .put("level", level)
    .put("lat", lat ?: JSONObject.NULL)
    .put("lon", lon ?: JSONObject.NULL)
    .put("speedMps", speedMps ?: JSONObject.NULL)
    .put("overlaps", JSONArray(overlaps))
  if (impactDirection != null) {
    json.put("impactDirection", impactDirection)
  }
  return json
}

private fun TripMetrics.toJsonObject(): JSONObject {
  val counts = JSONObject()
  for ((key, value) in eventCounts) {
    counts.put(key, value)
  }
  return JSONObject()
    .put("distanceM", distanceM)
    .put("durationMs", durationMs)
    .put("maxSpeedMps", maxSpeedMps ?: JSONObject.NULL)
    .put("avgSpeedMps", avgSpeedMps ?: JSONObject.NULL)
    .put("score", score)
    .put("eventCounts", counts)
}
