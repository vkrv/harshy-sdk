package com.harshy.sdk

import kotlin.math.abs

internal const val BRAKE_MIN_DROP_MPS = 2.0
internal const val BRAKE_PATH_SPEED_X = 0.75
internal const val IMU_BRAKE_HOLD_MS = 300.0
internal const val IMU_BRAKE_GAP_MS = 150.0
internal const val IMU_BRAKE_LEARN_MIN_MPS = 3.0
internal const val IMU_BRAKE_LEARN_MIN_MPS2 = 0.8
internal const val IMU_BRAKE_MIN_HORIZONTAL_MPS2 = 0.5
internal const val IMU_BRAKE_AXIS_ALPHA = 0.15
internal const val IMU_BRAKE_AXIS_TILT_DEG = 20.0
internal const val IMU_BRAKE_RECENT_MS = 4000.0

internal data class GpsBrakeSample(
  val longitudinal: Double?,
  val entrySpeedMps: Double?,
  val exitSpeedMps: Double?,
  val dtSec: Double?,
  val stepM: Double?,
)

internal fun gpsHarshBrakeQualifies(
  sample: GpsBrakeSample,
  minSpeedMps: Double,
  harshBrakeMps2: Double,
): Boolean {
  val longitudinal = sample.longitudinal
  val entry = sample.entrySpeedMps
  val exit = sample.exitSpeedMps
  if (longitudinal == null || entry == null || exit == null || longitudinal > -harshBrakeMps2) {
    return false
  }
  if (exit >= minSpeedMps) {
    return true
  }
  if (entry < minSpeedMps || entry - exit < BRAKE_MIN_DROP_MPS) {
    return false
  }
  val dt = sample.dtSec
  val step = sample.stepM
  if (dt == null || step == null || dt <= 0.0) {
    return false
  }
  return step / dt < entry * BRAKE_PATH_SPEED_X
}

internal fun horizontalLinear(linear: Vec3, gravity: Vec3?): Vec3 {
  if (gravity == null) {
    return Vec3(linear.x, linear.y, 0.0)
  }
  val g2 = gravity.x * gravity.x + gravity.y * gravity.y + gravity.z * gravity.z
  if (g2 < 0.25) {
    return linear
  }
  val along = (linear.x * gravity.x + linear.y * gravity.y + linear.z * gravity.z) / g2
  return Vec3(
    linear.x - gravity.x * along,
    linear.y - gravity.y * along,
    linear.z - gravity.z * along,
  )
}

internal fun forwardSampleFromGps(horizontal: Vec3, gpsLongitudinal: Double): Vec3? {
  if (abs(gpsLongitudinal) < IMU_BRAKE_LEARN_MIN_MPS2) {
    return null
  }
  if (magnitude(horizontal) < IMU_BRAKE_MIN_HORIZONTAL_MPS2) {
    return null
  }
  val sign = if (gpsLongitudinal >= 0.0) 1.0 else -1.0
  return Vec3(horizontal.x * sign, horizontal.y * sign, horizontal.z * sign)
}

internal fun blendForwardAxis(current: Vec3?, sample: Vec3, alpha: Double = IMU_BRAKE_AXIS_ALPHA): Vec3? {
  val length = magnitude(sample)
  if (length < 1e-6) {
    return current
  }
  val incoming = Vec3(sample.x / length, sample.y / length, sample.z / length)
  if (current == null) {
    return incoming
  }
  val mixed = Vec3(
    current.x * (1.0 - alpha) + incoming.x * alpha,
    current.y * (1.0 - alpha) + incoming.y * alpha,
    current.z * (1.0 - alpha) + incoming.z * alpha,
  )
  val mixedLength = magnitude(mixed)
  if (mixedLength < 1e-6) {
    return current
  }
  return Vec3(mixed.x / mixedLength, mixed.y / mixedLength, mixed.z / mixedLength)
}

internal fun brakeAlongForward(horizontal: Vec3, forward: Vec3): Double {
  return -(horizontal.x * forward.x + horizontal.y * forward.y + horizontal.z * forward.z)
}
