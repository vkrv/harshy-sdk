package com.harshy.sdk

import kotlin.math.roundToInt
import kotlin.math.roundToLong

/** Capture rates the native engines accept. Values outside are clamped. */
val IMU_HZ_RANGE: IntRange = 5..100
val LOCATION_INTERVAL_MS_RANGE: LongRange = 200L..5_000L

/**
 * Detector config from a loosely typed map, such as remote configuration, layered on [base].
 *
 * Keys use the `DetectorConfig` field names. Unknown keys are ignored, and a value that is not a
 * number or breaks the bounds of the `@harshy/core` schema keeps the [base] value, so one bad key
 * never discards the rest. `speedingMps` may be null to switch speeding off. A nested `score` map
 * updates the score weights the same way.
 */
fun detectorConfigFromMap(raw: Map<String, Any?>?, base: DetectorConfig = DetectorConfig.DEFAULT): DetectorConfig {
  var config = mergeDetectorConfig(base)
  if (raw == null) {
    return config
  }
  raw.valid("harshAccelMps2", Bound.POSITIVE)?.let { config = config.copy(harshAccelMps2 = it) }
  raw.valid("harshBrakeMps2", Bound.POSITIVE)?.let { config = config.copy(harshBrakeMps2 = it) }
  raw.valid("harshCornerMps2", Bound.POSITIVE)?.let { config = config.copy(harshCornerMps2 = it) }
  raw.valid("harshMediumX", Bound.POSITIVE)?.let { config = config.copy(harshMediumX = it) }
  raw.valid("harshHeavyX", Bound.POSITIVE)?.let { config = config.copy(harshHeavyX = it) }
  raw.valid("harshSwerveRadps", Bound.POSITIVE)?.let { config = config.copy(harshSwerveRadps = it) }
  raw.valid("harshSwerveJerkRadps2", Bound.POSITIVE)?.let { config = config.copy(harshSwerveJerkRadps2 = it) }
  raw.valid("swerveMinSpeedMps", Bound.NON_NEGATIVE)?.let { config = config.copy(swerveMinSpeedMps = it) }
  raw.valid("swerveMaxElevatedMs", Bound.POSITIVE)?.let { config = config.copy(swerveMaxElevatedMs = it) }
  raw.valid("speedingExitX", Bound.POSITIVE, max = 1.0)?.let { config = config.copy(speedingExitX = it) }
  raw.valid("minSpeedMps", Bound.NON_NEGATIVE)?.let { config = config.copy(minSpeedMps = it) }
  raw.valid("cooldownMs", Bound.NON_NEGATIVE)?.let { config = config.copy(cooldownMs = it) }
  raw.valid("compoundWindowMs", Bound.NON_NEGATIVE)?.let { config = config.copy(compoundWindowMs = it) }
  raw.valid("jerkSettleMs", Bound.NON_NEGATIVE)?.let { config = config.copy(jerkSettleMs = it) }
  raw.valid("gpsAccelWindowMs", Bound.POSITIVE)?.let { config = config.copy(gpsAccelWindowMs = it) }
  raw.valid("maxLocationAccuracyM", Bound.POSITIVE)?.let { config = config.copy(maxLocationAccuracyM = it) }
  raw.valid("impactFloorMps2", Bound.POSITIVE)?.let { config = config.copy(impactFloorMps2 = it) }
  raw.valid("impactPeakMps2", Bound.POSITIVE)?.let { config = config.copy(impactPeakMps2 = it) }
  raw.valid("impactPeakHighMps2", Bound.POSITIVE)?.let { config = config.copy(impactPeakHighMps2 = it) }
  raw.valid("impactPulseMaxMs", Bound.POSITIVE)?.let { config = config.copy(impactPulseMaxMs = it) }
  raw.valid("impactSpeedDeltaMps", Bound.NON_NEGATIVE)?.let { config = config.copy(impactSpeedDeltaMps = it) }
  raw.valid("impactLookaheadMs", Bound.POSITIVE)?.let { config = config.copy(impactLookaheadMs = it) }
  raw.valid("impactCooldownMs", Bound.NON_NEGATIVE)?.let { config = config.copy(impactCooldownMs = it) }
  raw.valid("impactVerticalMax", Bound.NON_NEGATIVE, max = 1.0)?.let { config = config.copy(impactVerticalMax = it) }
  raw.valid("impactFreeFallMps2", Bound.POSITIVE)?.let { config = config.copy(impactFreeFallMps2 = it) }
  raw.valid("impactFreeFallLookbackMs", Bound.NON_NEGATIVE)?.let { config = config.copy(impactFreeFallLookbackMs = it) }
  raw.valid("impactRolloverDeg", Bound.POSITIVE)?.let { config = config.copy(impactRolloverDeg = it) }
  raw.valid("handheldTiltDeg", Bound.POSITIVE)?.let { config = config.copy(handheldTiltDeg = it) }
  raw.valid("handheldExitTiltDeg", Bound.POSITIVE)?.let { config = config.copy(handheldExitTiltDeg = it) }
  raw.valid("handheldGyroRadps", Bound.POSITIVE)?.let { config = config.copy(handheldGyroRadps = it) }
  raw.valid("handheldMotionMps2", Bound.POSITIVE)?.let { config = config.copy(handheldMotionMps2 = it) }
  raw.valid("handheldQuietGyroRadps", Bound.POSITIVE)?.let { config = config.copy(handheldQuietGyroRadps = it) }
  raw.valid("handheldQuietMotionMps2", Bound.POSITIVE)?.let { config = config.copy(handheldQuietMotionMps2 = it) }
  raw.valid("handheldStableMs", Bound.NON_NEGATIVE)?.let { config = config.copy(handheldStableMs = it) }
  raw.valid("handheldConfirmMs", Bound.NON_NEGATIVE)?.let { config = config.copy(handheldConfirmMs = it) }
  raw.valid("handheldExitMs", Bound.NON_NEGATIVE)?.let { config = config.copy(handheldExitMs = it) }
  raw.valid("handheldCooldownMs", Bound.NON_NEGATIVE)?.let { config = config.copy(handheldCooldownMs = it) }
  raw.valid("handheldBaselineAlpha", Bound.POSITIVE, max = 1.0)?.let { config = config.copy(handheldBaselineAlpha = it) }
  if (raw.containsKey("speedingMps")) {
    val value = raw["speedingMps"]
    if (value == null) {
      config = config.copy(speedingMps = null)
    } else {
      value.finiteDouble()?.takeIf { it > 0.0 }?.let { config = config.copy(speedingMps = it) }
    }
  }
  @Suppress("UNCHECKED_CAST")
  val scoreRaw = raw["score"] as? Map<String, Any?>
  if (scoreRaw != null) {
    var score = config.score
    scoreRaw.valid("start", Bound.ANY)?.let { score = score.copy(start = it) }
    scoreRaw.valid("harshAccel", Bound.ANY)?.let { score = score.copy(harshAccel = it) }
    scoreRaw.valid("harshBrake", Bound.ANY)?.let { score = score.copy(harshBrake = it) }
    scoreRaw.valid("harshCorner", Bound.ANY)?.let { score = score.copy(harshCorner = it) }
    scoreRaw.valid("swerve", Bound.ANY)?.let { score = score.copy(swerve = it) }
    scoreRaw.valid("speeding", Bound.ANY)?.let { score = score.copy(speeding = it) }
    scoreRaw.valid("jerk", Bound.ANY)?.let { score = score.copy(jerk = it) }
    scoreRaw.valid("compound", Bound.ANY)?.let { score = score.copy(compound = it) }
    scoreRaw.valid("smoothAccel", Bound.NON_NEGATIVE)?.let { score = score.copy(smoothAccel = it) }
    scoreRaw.valid("smoothBrake", Bound.NON_NEGATIVE)?.let { score = score.copy(smoothBrake = it) }
    scoreRaw.valid("smoothCorner", Bound.NON_NEGATIVE)?.let { score = score.copy(smoothCorner = it) }
    scoreRaw.valid("refDistanceKm", Bound.POSITIVE)?.let { score = score.copy(refDistanceKm = it) }
    scoreRaw.valid("refDurationMin", Bound.POSITIVE)?.let { score = score.copy(refDurationMin = it) }
    scoreRaw.valid("minDistanceKm", Bound.POSITIVE)?.let { score = score.copy(minDistanceKm = it) }
    scoreRaw.valid("minDurationMin", Bound.POSITIVE)?.let { score = score.copy(minDurationMin = it) }
    config = config.copy(score = score)
  }
  return config
}

/**
 * Capture options from a loosely typed map, layered on [base]. `imuHz` and `locationIntervalMs`
 * are rounded and clamped to [IMU_HZ_RANGE] and [LOCATION_INTERVAL_MS_RANGE]. Every other key,
 * including `background` and `trigger`, is ignored and keeps the [base] value: a remote config tunes
 * rates only, and `HeadlessTripRecorder` takes the trigger as its own parameter.
 */
fun nativeStartOptionsFromMap(raw: Map<String, Any?>?, base: NativeStartOptions = NativeStartOptions()): NativeStartOptions {
  if (raw == null) {
    return base
  }
  val imuHz = raw["imuHz"].finiteDouble()?.roundToInt()?.coerceIn(IMU_HZ_RANGE) ?: base.imuHz
  val intervalMs = raw["locationIntervalMs"].finiteDouble()?.roundToLong()?.coerceIn(LOCATION_INTERVAL_MS_RANGE)
    ?: base.locationIntervalMs
  return base.copy(imuHz = imuHz, locationIntervalMs = intervalMs)
}

private enum class Bound { ANY, POSITIVE, NON_NEGATIVE }

private fun Any?.finiteDouble(): Double? = (this as? Number)?.toDouble()?.takeIf { it.isFinite() }

private fun Map<String, Any?>.valid(key: String, bound: Bound, max: Double? = null): Double? {
  val value = this[key].finiteDouble() ?: return null
  val inBounds = when (bound) {
    Bound.ANY -> true
    Bound.POSITIVE -> value > 0.0
    Bound.NON_NEGATIVE -> value >= 0.0
  }
  return value.takeIf { inBounds && (max == null || it <= max) }
}
