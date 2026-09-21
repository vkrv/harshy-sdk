package com.harshy.engine

import java.util.ArrayDeque
import kotlin.math.abs
import kotlin.math.sqrt

/** Matches `@harshy/core` ROAD_WINDOW_MS / default detector settle + min speed. */
internal object RoadStamp {
  const val WINDOW_MS = 1000L
  const val JERK_SETTLE_MS = 1500L
  const val MIN_SPEED_MPS = 2.0

  /**
   * World-up linear-accel RMS for one GPS sample from the live IMU ring.
   * Walks newest-first so a multi-hour ring stays O(window), not O(n).
   */
  fun roadRmsMps2(
    tMs: Long,
    speedMps: Double?,
    startedAtMs: Long,
    imu: ArrayDeque<Map<String, Any?>>,
  ): Double? {
    val speed = speedMps ?: 0.0
    val settleUntil = startedAtMs + JERK_SETTLE_MS
    if (tMs < settleUntil || speed < MIN_SPEED_MPS) {
      return null
    }
    val lo = tMs - WINDOW_MS
    val hi = tMs
    var sumSq = 0.0
    var n = 0
    val newestFirst = imu.descendingIterator()
    while (newestFirst.hasNext()) {
      val sample = newestFirst.next()
      val imuT = (sample["t"] as? Number)?.toLong() ?: continue
      if (imuT > hi) {
        continue
      }
      if (imuT < lo) {
        break
      }
      if (imuT < settleUntil) {
        continue
      }
      val vertical = verticalLinearAccel(sample)
      sumSq += vertical * vertical
      n += 1
    }
    return if (n == 0) null else sqrt(sumSq / n)
  }

  fun withRoadRms(
    sample: Map<String, Any?>,
    startedAtMs: Long,
    imu: ArrayDeque<Map<String, Any?>>,
  ): Map<String, Any?> {
    if (sample["roadRmsMps2"] is Number) {
      return sample
    }
    val tMs = (sample["t"] as? Number)?.toLong() ?: return sample
    val speed = (sample["speedMps"] as? Number)?.toDouble()
    val rms = roadRmsMps2(tMs, speed, startedAtMs, imu)
    return sample + ("roadRmsMps2" to rms)
  }

  @Suppress("UNCHECKED_CAST")
  private fun verticalLinearAccel(sample: Map<String, Any?>): Double {
    val linear = sample["linearAccel"] as? Map<String, Any?>
    val accel = linear ?: (sample["accel"] as? Map<String, Any?>) ?: return 0.0
    val ax = (accel["x"] as? Number)?.toDouble() ?: 0.0
    val ay = (accel["y"] as? Number)?.toDouble() ?: 0.0
    val az = (accel["z"] as? Number)?.toDouble() ?: 0.0
    val gravity = sample["gravity"] as? Map<String, Any?>
    if (gravity != null) {
      val gx = (gravity["x"] as? Number)?.toDouble() ?: 0.0
      val gy = (gravity["y"] as? Number)?.toDouble() ?: 0.0
      val gz = (gravity["z"] as? Number)?.toDouble() ?: 0.0
      val mag = sqrt(gx * gx + gy * gy + gz * gz)
      if (mag > 0.5) {
        val projected = (ax * gx + ay * gy + az * gz) / mag
        return abs(if (linear != null) projected else projected - mag)
      }
    }
    return abs(if (linear != null) (linear["z"] as? Number)?.toDouble() ?: 0.0 else az)
  }
}
