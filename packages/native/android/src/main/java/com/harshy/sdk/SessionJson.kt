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
  val deviceJson = JSONObject()
  deviceJson.put("platform", device.platform)
  deviceJson.put("model", device.model ?: JSONObject.NULL)
  json.put("device", deviceJson)
  json.put("trigger", trigger)
  capture?.let { json.put("capture", it.toJsonObject()) }
  return json
}

private fun NativeStartOptions.toJsonObject(): JSONObject {
  // Do not chain put() — Android unit-test stubs return null from put.
  val json = JSONObject()
  json.put("imuHz", imuHz)
  json.put("locationIntervalMs", locationIntervalMs)
  json.put("background", background)
  if (trigger != null) {
    json.put("trigger", trigger)
  }
  return json
}

private fun DetectorConfig.toJsonObject(): JSONObject {
  // Do not chain put() — Android unit-test stubs return null from put.
  val json = JSONObject()
  json.put("harshAccelMps2", harshAccelMps2)
  json.put("harshBrakeMps2", harshBrakeMps2)
  json.put("harshCornerMps2", harshCornerMps2)
  json.put("harshMediumX", harshMediumX)
  json.put("harshHeavyX", harshHeavyX)
  json.put("harshSwerveRadps", harshSwerveRadps)
  json.put("harshSwerveJerkRadps2", harshSwerveJerkRadps2)
  json.put("swerveMinSpeedMps", swerveMinSpeedMps)
  json.put("swerveMaxElevatedMs", swerveMaxElevatedMs)
  json.put("speedingMps", speedingMps ?: JSONObject.NULL)
  json.put("speedingExitX", speedingExitX)
  json.put("minSpeedMps", minSpeedMps)
  json.put("cooldownMs", cooldownMs)
  json.put("compoundWindowMs", compoundWindowMs)
  json.put("jerkSettleMs", jerkSettleMs)
  json.put("gpsAccelWindowMs", gpsAccelWindowMs)
  json.put("maxLocationAccuracyM", maxLocationAccuracyM)
  json.put("impactFloorMps2", impactFloorMps2)
  json.put("impactPeakMps2", impactPeakMps2)
  json.put("impactPeakHighMps2", impactPeakHighMps2)
  json.put("impactPulseMaxMs", impactPulseMaxMs)
  json.put("impactSpeedDeltaMps", impactSpeedDeltaMps)
  json.put("impactLookaheadMs", impactLookaheadMs)
  json.put("impactCooldownMs", impactCooldownMs)
  json.put("impactVerticalMax", impactVerticalMax)
  json.put("impactFreeFallMps2", impactFreeFallMps2)
  json.put("impactFreeFallLookbackMs", impactFreeFallLookbackMs)
  json.put("impactRolloverDeg", impactRolloverDeg)
  json.put("handheldTiltDeg", handheldTiltDeg)
  json.put("handheldExitTiltDeg", handheldExitTiltDeg)
  json.put("handheldGyroRadps", handheldGyroRadps)
  json.put("handheldMotionMps2", handheldMotionMps2)
  json.put("handheldQuietGyroRadps", handheldQuietGyroRadps)
  json.put("handheldQuietMotionMps2", handheldQuietMotionMps2)
  json.put("handheldStableMs", handheldStableMs)
  json.put("handheldConfirmMs", handheldConfirmMs)
  json.put("handheldExitMs", handheldExitMs)
  json.put("handheldCooldownMs", handheldCooldownMs)
  json.put("handheldBaselineAlpha", handheldBaselineAlpha)
  val scoreJson = JSONObject()
  scoreJson.put("start", score.start)
  scoreJson.put("harshAccel", score.harshAccel)
  scoreJson.put("harshBrake", score.harshBrake)
  scoreJson.put("harshCorner", score.harshCorner)
  scoreJson.put("swerve", score.swerve)
  scoreJson.put("speeding", score.speeding)
  scoreJson.put("jerk", score.jerk)
  scoreJson.put("compound", score.compound)
  scoreJson.put("refDistanceKm", score.refDistanceKm)
  scoreJson.put("refDurationMin", score.refDurationMin)
  scoreJson.put("minDistanceKm", score.minDistanceKm)
  scoreJson.put("minDurationMin", score.minDurationMin)
  scoreJson.put("smoothAccel", score.smoothAccel)
  scoreJson.put("smoothBrake", score.smoothBrake)
  scoreJson.put("smoothCorner", score.smoothCorner)
  json.put("score", scoreJson)
  return json
}

private fun LocationSample.toJsonObject(): JSONObject {
  val json = JSONObject()
  json.put("t", t)
  json.put("lat", lat)
  json.put("lon", lon)
  json.put("altitudeM", altitudeM ?: JSONObject.NULL)
  json.put("speedMps", speedMps ?: JSONObject.NULL)
  json.put("courseDeg", courseDeg ?: JSONObject.NULL)
  json.put("accuracyM", accuracyM ?: JSONObject.NULL)
  json.put("altitudeAccuracyM", altitudeAccuracyM ?: JSONObject.NULL)
  json.put("roadRmsMps2", roadRmsMps2 ?: JSONObject.NULL)
  return json
}

private fun ImuSample.toJsonObject(): JSONObject {
  val json = JSONObject()
  json.put("t", t)
  json.put("accel", accel.toJsonObject())
  json.put("linearAccel", linearAccel?.toJsonObject() ?: JSONObject.NULL)
  json.put("gyro", gyro?.toJsonObject() ?: JSONObject.NULL)
  json.put("magnetometer", magnetometer?.toJsonObject() ?: JSONObject.NULL)
  json.put(
    "attitude",
    attitude?.let {
      val att = JSONObject()
      att.put("pitch", it.pitch)
      att.put("roll", it.roll)
      att.put("yaw", it.yaw)
      att
    } ?: JSONObject.NULL,
  )
  json.put("gravity", gravity?.toJsonObject() ?: JSONObject.NULL)
  json.put("barometerHpa", barometerHpa ?: JSONObject.NULL)
  return json
}

private fun Vec3.toJsonObject(): JSONObject {
  val json = JSONObject()
  json.put("x", x)
  json.put("y", y)
  json.put("z", z)
  return json
}

private fun DrivingEvent.toJsonObject(): JSONObject {
  val json = JSONObject()
  json.put("id", id)
  json.put("type", type)
  json.put("t", t)
  json.put("endT", endT ?: JSONObject.NULL)
  json.put("peak", peak)
  json.put("severity", severity)
  json.put("level", level)
  json.put("lat", lat ?: JSONObject.NULL)
  json.put("lon", lon ?: JSONObject.NULL)
  json.put("speedMps", speedMps ?: JSONObject.NULL)
  json.put("overlaps", JSONArray(overlaps))
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
  val json = JSONObject()
  json.put("distanceM", distanceM)
  json.put("durationMs", durationMs)
  json.put("maxSpeedMps", maxSpeedMps ?: JSONObject.NULL)
  json.put("avgSpeedMps", avgSpeedMps ?: JSONObject.NULL)
  json.put("points", points)
  json.put("score", score)
  json.put("eventCounts", counts)
  return json
}
