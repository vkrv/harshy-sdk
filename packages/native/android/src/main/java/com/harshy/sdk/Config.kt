package com.harshy.sdk

/** Event penalties apply at 1/2. */
const val SCORE_PENALTY_X = 1.0 / 2.0

data class DetectorScoreWeights(
  val start: Double = 100.0,
  val harshAccel: Double = 6.0,
  val harshBrake: Double = 8.0,
  val harshCorner: Double = 6.0,
  val swerve: Double = 5.0,
  val speeding: Double = 4.0,
  val jerk: Double = 3.0,
  val compound: Double = 3.0,
  val refDistanceKm: Double = 5.0,
  val refDurationMin: Double = 10.0,
  val minDistanceKm: Double = 2.0,
  val minDurationMin: Double = 5.0,
)

data class DetectorConfig(
  val harshAccelMps2: Double = 2.5,
  val harshBrakeMps2: Double = 3.0,
  val harshCornerMps2: Double = 3.0,
  val harshMediumX: Double = DEFAULT_HARSH_MEDIUM_X,
  val harshHeavyX: Double = DEFAULT_HARSH_HEAVY_X,
  val harshSwerveRadps: Double = 0.45,
  val speedingMps: Double? = null,
  val speedingExitX: Double = 0.95,
  val minSpeedMps: Double = 2.0,
  val cooldownMs: Double = 3500.0,
  val compoundWindowMs: Double = 3500.0,
  val jerkSettleMs: Double = 1500.0,
  val gpsAccelWindowMs: Double = 1000.0,
  val maxLocationAccuracyM: Double = 40.0,
  val impactFloorMps2: Double = DEFAULT_IMPACT_FLOOR_MPS2,
  val impactPeakMps2: Double = DEFAULT_IMPACT_PEAK_MPS2,
  val impactPeakHighMps2: Double = DEFAULT_IMPACT_PEAK_HIGH_MPS2,
  val impactPulseMaxMs: Double = DEFAULT_IMPACT_PULSE_MAX_MS,
  val impactSpeedDeltaMps: Double = DEFAULT_IMPACT_SPEED_DELTA_MPS,
  val impactLookaheadMs: Double = DEFAULT_IMPACT_LOOKAHEAD_MS,
  val impactCooldownMs: Double = DEFAULT_IMPACT_COOLDOWN_MS,
  val impactVerticalMax: Double = DEFAULT_IMPACT_VERTICAL_MAX,
  val impactFreeFallMps2: Double = DEFAULT_IMPACT_FREE_FALL_MPS2,
  val impactFreeFallLookbackMs: Double = DEFAULT_IMPACT_FREE_FALL_LOOKBACK_MS,
  val impactRolloverDeg: Double = DEFAULT_IMPACT_ROLLOVER_DEG,
  val handheldTiltDeg: Double = DEFAULT_HANDHELD_TILT_DEG,
  val handheldExitTiltDeg: Double = DEFAULT_HANDHELD_EXIT_TILT_DEG,
  val handheldGyroRadps: Double = DEFAULT_HANDHELD_GYRO_RADPS,
  val handheldMotionMps2: Double = DEFAULT_HANDHELD_MOTION_MPS2,
  val handheldQuietGyroRadps: Double = DEFAULT_HANDHELD_QUIET_GYRO_RADPS,
  val handheldQuietMotionMps2: Double = DEFAULT_HANDHELD_QUIET_MOTION_MPS2,
  val handheldStableMs: Double = DEFAULT_HANDHELD_STABLE_MS,
  val handheldConfirmMs: Double = DEFAULT_HANDHELD_CONFIRM_MS,
  val handheldExitMs: Double = DEFAULT_HANDHELD_EXIT_MS,
  val handheldCooldownMs: Double = DEFAULT_HANDHELD_COOLDOWN_MS,
  val handheldBaselineAlpha: Double = DEFAULT_HANDHELD_BASELINE_ALPHA,
  val score: DetectorScoreWeights = DetectorScoreWeights(),
) {
  companion object {
    val DEFAULT: DetectorConfig = DetectorConfig()
  }
}

fun mergeDetectorConfig(overrides: DetectorConfig? = null): DetectorConfig {
  if (overrides == null) {
    return DetectorConfig.DEFAULT.copy(score = DetectorConfig.DEFAULT.score.copy())
  }
  return overrides.copy(score = overrides.score.copy())
}

fun mergeNativeStartOptions(overrides: NativeStartOptions? = null): NativeStartOptions {
  return overrides ?: NativeStartOptions()
}
