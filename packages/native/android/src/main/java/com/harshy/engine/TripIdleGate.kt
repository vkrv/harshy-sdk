package com.harshy.engine

import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Silent storage thinning while nearly stopped. Trip UI stays running.
 * Matches `@harshy/core` tripBuffer idle policy.
 */
internal class TripIdleGate(
  private val minSpeedMps: Double = DEFAULT_MIN_SPEED_MPS,
  private val hysteresisMs: Long = IDLE_HYSTERESIS_MS,
  private val idleLocationIntervalMs: Long = IDLE_LOCATION_INTERVAL_MS,
  private val idleLocationMinMoveM: Double = IDLE_LOCATION_MIN_MOVE_M,
) {
  private var belowSinceMs: Long? = null
  private var lastIdleLocationAtMs: Long? = null
  private var lastIdleLat: Double? = null
  private var lastIdleLon: Double? = null

  fun reset() {
    belowSinceMs = null
    lastIdleLocationAtMs = null
    lastIdleLat = null
    lastIdleLon = null
  }

  /** Update from a GPS fix; returns whether the vehicle is idle for thinning. */
  fun advance(tMs: Long, speedMps: Double?): Boolean {
    if (speedMps == null || !speedMps.isFinite()) {
      return isIdle(tMs)
    }
    if (speedMps >= minSpeedMps) {
      belowSinceMs = null
    } else if (belowSinceMs == null) {
      belowSinceMs = tMs
    }
    return isIdle(tMs)
  }

  fun isIdle(nowMs: Long = System.currentTimeMillis()): Boolean {
    val since = belowSinceMs ?: return false
    return nowMs - since >= hysteresisMs
  }

  /** Whether to keep this GPS sample while already idle. */
  fun shouldKeepIdleLocation(tMs: Long, lat: Double, lon: Double): Boolean {
    val lastAt = lastIdleLocationAtMs
    val moved =
      lastIdleLat != null &&
        lastIdleLon != null &&
        haversineM(lastIdleLat!!, lastIdleLon!!, lat, lon) >= idleLocationMinMoveM
    val due = lastAt == null || tMs - lastAt >= idleLocationIntervalMs
    if (!due && !moved) {
      return false
    }
    lastIdleLocationAtMs = tMs
    lastIdleLat = lat
    lastIdleLon = lon
    return true
  }

  companion object {
    const val DEFAULT_MIN_SPEED_MPS = 2.0
    const val IDLE_HYSTERESIS_MS = 2500L
    const val IDLE_LOCATION_INTERVAL_MS = 8_000L
    const val IDLE_LOCATION_MIN_MOVE_M = 15.0
    const val MAX_LOCATION_SAMPLES = 20_000
    const val MAX_IMU_MINUTES = 120

    fun maxImuSamples(imuHz: Int): Int = imuHz.coerceAtLeast(1) * 60 * MAX_IMU_MINUTES

    /** Target length after an overflow trim (2% slack) so ring drops are amortized. */
    fun ringTarget(max: Int): Int {
      if (max < 50) {
        return max
      }
      val slack = maxOf(1, max / 50)
      return max - slack
    }
  }
}

private fun haversineM(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
  val dLat = Math.toRadians(lat2 - lat1)
  val dLon = Math.toRadians(lon2 - lon1)
  val a =
    sin(dLat / 2) * sin(dLat / 2) +
      cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) *
      sin(dLon / 2) * sin(dLon / 2)
  return 2 * 6_371_000 * asin(min(1.0, sqrt(a)))
}
