package com.harshy.sdk

import kotlin.math.abs
import kotlin.math.sqrt

internal const val ROAD_WINDOW_MS = 1000.0

internal fun verticalLinearAccel(sample: ImuSample): Double {
  val linear = sample.linearAccel
  val accel = linear ?: sample.accel
  val gravity = sample.gravity
  if (gravity != null) {
    val mag = magnitude(gravity)
    if (mag > 0.5) {
      val projected = (accel.x * gravity.x + accel.y * gravity.y + accel.z * gravity.z) / mag
      return abs(if (linear != null) projected else projected - mag)
    }
  }
  return abs(if (linear != null) linear.z else sample.accel.z)
}

internal fun assessRoad(
  location: List<LocationSample>,
  imu: List<ImuSample>,
  startedAtMs: Double,
  jerkSettleMs: Double,
  minSpeedMps: Double,
  windowMs: Double = ROAD_WINDOW_MS,
): List<LocationSample> {
  val settleUntil = startedAtMs + jerkSettleMs
  if (imu.isEmpty()) {
    return location.map { sample ->
      sample.copy(roadRmsMps2 = sample.roadRmsMps2)
    }
  }

  val samples = imu.sortedBy { it.t }
  var start = 0

  return location.map { sample ->
    if (sample.roadRmsMps2 != null) {
      return@map sample
    }
    val speed = sample.speedMps ?: 0.0
    if (sample.t < settleUntil || speed < minSpeedMps) {
      return@map sample.copy(roadRmsMps2 = null)
    }

    val lo = sample.t - windowMs
    val hi = sample.t
    while (start < samples.size && samples[start].t < lo) {
      start += 1
    }

    var sumSq = 0.0
    var n = 0
    for (i in start until samples.size) {
      val imuSample = samples[i]
      if (imuSample.t > hi) {
        break
      }
      if (imuSample.t < settleUntil) {
        continue
      }
      val vertical = verticalLinearAccel(imuSample)
      sumSq += vertical * vertical
      n += 1
    }

    sample.copy(roadRmsMps2 = if (n == 0) null else sqrt(sumSq / n))
  }
}
