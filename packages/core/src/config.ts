import { DEFAULT_HARSH_HEAVY_X, DEFAULT_HARSH_MEDIUM_X } from "./harsh.js";
import {
  DEFAULT_HANDHELD_BASELINE_ALPHA,
  DEFAULT_HANDHELD_CONFIRM_MS,
  DEFAULT_HANDHELD_COOLDOWN_MS,
  DEFAULT_HANDHELD_EXIT_MS,
  DEFAULT_HANDHELD_EXIT_TILT_DEG,
  DEFAULT_HANDHELD_GYRO_RADPS,
  DEFAULT_HANDHELD_MOTION_MPS2,
  DEFAULT_HANDHELD_QUIET_GYRO_RADPS,
  DEFAULT_HANDHELD_QUIET_MOTION_MPS2,
  DEFAULT_HANDHELD_STABLE_MS,
  DEFAULT_HANDHELD_TILT_DEG,
} from "./handheld.js";
import {
  DEFAULT_IMPACT_COOLDOWN_MS,
  DEFAULT_IMPACT_FLOOR_MPS2,
  DEFAULT_IMPACT_FREE_FALL_LOOKBACK_MS,
  DEFAULT_IMPACT_FREE_FALL_MPS2,
  DEFAULT_IMPACT_LOOKAHEAD_MS,
  DEFAULT_IMPACT_PEAK_HIGH_MPS2,
  DEFAULT_IMPACT_PEAK_MPS2,
  DEFAULT_IMPACT_PULSE_MAX_MS,
  DEFAULT_IMPACT_ROLLOVER_DEG,
  DEFAULT_IMPACT_SPEED_DELTA_MPS,
  DEFAULT_IMPACT_VERTICAL_MAX,
} from "./impact.js";
import type { DetectorConfig, NativeStartOptions } from "./types.js";

/** Event penalties apply at 1/3 so everyday driving stays in a high score band. */
export const SCORE_PENALTY_X = 1 / 3;

export const DEFAULT_DETECTOR_CONFIG: DetectorConfig = {
  harshAccelMps2: 2.5,
  harshBrakeMps2: 3.0,
  harshCornerMps2: 3.0,
  harshMediumX: DEFAULT_HARSH_MEDIUM_X,
  harshHeavyX: DEFAULT_HARSH_HEAVY_X,
  harshSwerveRadps: 0.45,
  speedingMps: null,
  speedingExitX: 0.95,
  minSpeedMps: 2,
  /** Same-type peaks within this window upgrade one event instead of stacking. */
  cooldownMs: 3500,
  compoundWindowMs: 3500,
  /** Ignore IMU jerk after start so button haptics / handling the phone are not scored. */
  jerkSettleMs: 1500,
  gpsAccelWindowMs: 1000,
  maxLocationAccuracyM: 40,
  impactFloorMps2: DEFAULT_IMPACT_FLOOR_MPS2,
  impactPeakMps2: DEFAULT_IMPACT_PEAK_MPS2,
  impactPeakHighMps2: DEFAULT_IMPACT_PEAK_HIGH_MPS2,
  impactPulseMaxMs: DEFAULT_IMPACT_PULSE_MAX_MS,
  impactSpeedDeltaMps: DEFAULT_IMPACT_SPEED_DELTA_MPS,
  impactLookaheadMs: DEFAULT_IMPACT_LOOKAHEAD_MS,
  impactCooldownMs: DEFAULT_IMPACT_COOLDOWN_MS,
  impactVerticalMax: DEFAULT_IMPACT_VERTICAL_MAX,
  impactFreeFallMps2: DEFAULT_IMPACT_FREE_FALL_MPS2,
  impactFreeFallLookbackMs: DEFAULT_IMPACT_FREE_FALL_LOOKBACK_MS,
  impactRolloverDeg: DEFAULT_IMPACT_ROLLOVER_DEG,
  handheldTiltDeg: DEFAULT_HANDHELD_TILT_DEG,
  handheldExitTiltDeg: DEFAULT_HANDHELD_EXIT_TILT_DEG,
  handheldGyroRadps: DEFAULT_HANDHELD_GYRO_RADPS,
  handheldMotionMps2: DEFAULT_HANDHELD_MOTION_MPS2,
  handheldQuietGyroRadps: DEFAULT_HANDHELD_QUIET_GYRO_RADPS,
  handheldQuietMotionMps2: DEFAULT_HANDHELD_QUIET_MOTION_MPS2,
  handheldStableMs: DEFAULT_HANDHELD_STABLE_MS,
  handheldConfirmMs: DEFAULT_HANDHELD_CONFIRM_MS,
  handheldExitMs: DEFAULT_HANDHELD_EXIT_MS,
  handheldCooldownMs: DEFAULT_HANDHELD_COOLDOWN_MS,
  handheldBaselineAlpha: DEFAULT_HANDHELD_BASELINE_ALPHA,
  score: {
    start: 100,
    harshAccel: 6,
    harshBrake: 8,
    harshCorner: 6,
    swerve: 5,
    speeding: 4,
    jerk: 3,
    compound: 3,
    refDistanceKm: 10,
    refDurationMin: 15,
    minDistanceKm: 2,
    minDurationMin: 5,
  },
};

export const DEFAULT_NATIVE_START_OPTIONS: NativeStartOptions = {
  imuHz: 50,
  locationIntervalMs: 500,
  background: true,
};

export function mergeDetectorConfig(
  overrides: Partial<DetectorConfig> | undefined,
): DetectorConfig {
  if (!overrides) {
    return { ...DEFAULT_DETECTOR_CONFIG, score: { ...DEFAULT_DETECTOR_CONFIG.score } };
  }

  return {
    ...DEFAULT_DETECTOR_CONFIG,
    ...overrides,
    score: {
      ...DEFAULT_DETECTOR_CONFIG.score,
      ...overrides.score,
    },
  };
}

export function mergeNativeStartOptions(
  overrides: Partial<NativeStartOptions> | undefined,
): NativeStartOptions {
  return {
    ...DEFAULT_NATIVE_START_OPTIONS,
    ...overrides,
  };
}
