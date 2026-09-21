package com.harshy.engine

import android.location.Location

/**
 * Sparse armed-watch samples. Not trip journal GPS — no IMU, no FGS.
 */
object WatchFixMaps {
  const val STEP_WALKING_WINDOW_MS = 8_000L
  const val WATCH_MIN_TIME_MS = 8_000L
  const val WATCH_MIN_DISTANCE_M = 25f
  const val VEHICLE_SPEED_MPS = 5.5

  fun activityFromSteps(nowMs: Long, lastStepAtMs: Long?, speedMps: Double? = null): String {
    if (speedMps != null && speedMps.isFinite() && speedMps >= VEHICLE_SPEED_MPS) {
      return "unknown"
    }
    if (lastStepAtMs == null) {
      return "unknown"
    }
    return if (nowMs - lastStepAtMs <= STEP_WALKING_WINDOW_MS) "walking" else "unknown"
  }

  fun fromLocation(
    location: Location,
    activity: String,
    nowMs: Long = System.currentTimeMillis(),
  ): Map<String, Any?> {
    return fromFields(
      nowMs = nowMs,
      lat = location.latitude,
      lon = location.longitude,
      speedMps = if (location.hasSpeed()) location.speed.toDouble() else null,
      accuracyM = if (location.hasAccuracy()) location.accuracy.toDouble() else null,
      activity = activity,
    )
  }

  fun fromFields(
    nowMs: Long,
    lat: Double,
    lon: Double,
    speedMps: Double?,
    accuracyM: Double?,
    activity: String,
  ): Map<String, Any?> {
    return mapOf(
      "t" to nowMs,
      "lat" to lat,
      "lon" to lon,
      "speedMps" to speedMps,
      "accuracyM" to accuracyM,
      "activity" to activity,
    )
  }
}
