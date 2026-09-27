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

/** Event penalties and smooth credits apply at 1/2. */
export const SCORE_PENALTY_X = 1 / 2;

/** The ledger cannot rise above this. */
export const SCORE_MAX = 100;

/**
 * How strongly trip length scales the relative grade.
 * At `refDistanceKm` the weight is 1. Shorter trips raise it (harsh hits harder);
 * longer trips lower it. Floored by `minDistanceKm` so a 200 m start does not explode.
 */
export const SCORE_RELATIVE_EXPOSURE_MIN = 0.5;
export const SCORE_RELATIVE_EXPOSURE_MAX = 2.5;

export type RelativeScoreOptions = {
  refDistanceKm?: number;
  minDistanceKm?: number;
};

/** Weight applied to absolute points when building the 0–100 grade. 1 at the reference km. */
export function relativeScoreWeight(
  distanceM: number,
  options: RelativeScoreOptions = {},
): number {
  const refKm = options.refDistanceKm ?? 5;
  const minKm = options.minDistanceKm ?? 2;
  const km = Math.max(distanceM / 1000, minKm);
  const exposure = km / Math.max(refKm, 1e-6);
  const weight = 1 / Math.max(exposure, 1e-6);
  return Math.min(SCORE_RELATIVE_EXPOSURE_MAX, Math.max(SCORE_RELATIVE_EXPOSURE_MIN, weight));
}

/**
 * Relative 0–100 grade from the absolute ledger and trip length.
 * 0 points → 100. Negatives hurt more on short trips than on long ones (same points).
 * Smooth / positive ledgers still clamp at 100.
 */
export function relativeScore(
  points: number,
  distanceM = 0,
  options: RelativeScoreOptions = {},
): number {
  const weighted = points * relativeScoreWeight(distanceM, options);
  return Math.min(SCORE_MAX, Math.max(0, 100 + weighted));
}

/**
 * How far distance may stretch one event's weight.
 * A short trip is at most 1.6× the 5 km reference. A long trip keeps at least 0.6×.
 * Time is not part of this.
 */
export const SCORE_EXPOSURE_MIN = 0.6;
export const SCORE_EXPOSURE_MAX = 1.6;

/** Gentle accel, brake, or corner must be at least this strong (m/s²). */
export const SMOOTH_FLOOR_MPS2 = 0.5;

/** And no more than this fraction of that axis's harsh threshold. */
export const SMOOTH_CEILING_X = 0.6;

/** The maneuver has to stay in that band this long. */
export const SMOOTH_HOLD_MS = 3000;

/** And the car has to actually move during the hold. */
export const SMOOTH_HOLD_MIN_M = 15;

/** Same type waits until the trip covers this much more distance. */
export const SMOOTH_GAP_M = 400;

/**
 * Flat credit before the ½ factor. At the 5 km reference that is +0.8.
 * The severity curve does not apply.
 */
export const SMOOTH_CREDIT_WEIGHT = 1.6;

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
    smoothAccel: SMOOTH_CREDIT_WEIGHT,
    smoothBrake: SMOOTH_CREDIT_WEIGHT,
    smoothCorner: SMOOTH_CREDIT_WEIGHT,
    refDistanceKm: 5,
    refDurationMin: 10,
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
