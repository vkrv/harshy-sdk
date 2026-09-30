import { z } from "zod";

import { DEFAULT_DETECTOR_CONFIG, mergeDetectorConfig, mergeNativeStartOptions, relativeScore } from "./config.js";
import { DEFAULT_HARSH_HEAVY_X, DEFAULT_HARSH_MEDIUM_X } from "./harsh.js";
import type { DetectorConfig, SessionExport } from "./types.js";

export const vec3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

export const attitudeSchema = z.object({
  pitch: z.number(),
  roll: z.number(),
  yaw: z.number(),
});

export const locationSampleSchema = z.object({
  t: z.number(),
  lat: z.number(),
  lon: z.number(),
  altitudeM: z.number().nullable(),
  speedMps: z.number().nullable(),
  courseDeg: z.number().nullable(),
  accuracyM: z.number().nullable(),
  altitudeAccuracyM: z.number().nullable(),
  roadRmsMps2: z.number().nonnegative().nullable().optional(),
});

export const imuSampleSchema = z.object({
  t: z.number(),
  accel: vec3Schema,
  linearAccel: vec3Schema.nullable(),
  gyro: vec3Schema.nullable(),
  magnetometer: vec3Schema.nullable(),
  attitude: attitudeSchema.nullable(),
  gravity: vec3Schema.nullable(),
  barometerHpa: z.number().nullable(),
});

export const drivingEventTypeSchema = z.enum([
  "harsh_accel",
  "harsh_brake",
  "harsh_corner",
  "swerve",
  "speeding",
  "jerk",
  "possible_impact",
  "phone_handheld",
  "smooth_accel",
  "smooth_brake",
  "smooth_corner",
  "smooth_km",
]);

export const impactDirectionSchema = z.enum(["front", "rear", "rollover", "unknown"]);

export const harshEventLevelSchema = z.enum(["light", "medium", "heavy"]);

export const drivingEventSchema = z.object({
  id: z.string(),
  type: drivingEventTypeSchema,
  t: z.number(),
  endT: z.number().nullable(),
  peak: z.number(),
  severity: z.number().min(0).max(1),
  level: harshEventLevelSchema.default("light"),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  speedMps: z.number().nullable(),
  overlaps: z.array(drivingEventTypeSchema).default([]),
  impactDirection: impactDirectionSchema.optional(),
});

export const detectorConfigSchema = z.object({
  harshAccelMps2: z.number().positive(),
  harshBrakeMps2: z.number().positive(),
  harshCornerMps2: z.number().positive(),
  harshMediumX: z.number().positive().default(DEFAULT_HARSH_MEDIUM_X),
  harshHeavyX: z.number().positive().default(DEFAULT_HARSH_HEAVY_X),
  harshSwerveRadps: z.number().positive().default(DEFAULT_DETECTOR_CONFIG.harshSwerveRadps),
  harshSwerveJerkRadps2: z
    .number()
    .positive()
    .default(DEFAULT_DETECTOR_CONFIG.harshSwerveJerkRadps2),
  swerveMinSpeedMps: z.number().nonnegative().default(DEFAULT_DETECTOR_CONFIG.swerveMinSpeedMps),
  swerveMaxElevatedMs: z
    .number()
    .positive()
    .default(DEFAULT_DETECTOR_CONFIG.swerveMaxElevatedMs),
  speedingMps: z.number().positive().nullable(),
  speedingExitX: z.number().positive().max(1).default(DEFAULT_DETECTOR_CONFIG.speedingExitX),
  minSpeedMps: z.number().nonnegative(),
  cooldownMs: z.number().nonnegative(),
  compoundWindowMs: z
    .number()
    .nonnegative()
    .default(DEFAULT_DETECTOR_CONFIG.compoundWindowMs),
  jerkSettleMs: z.number().nonnegative().default(DEFAULT_DETECTOR_CONFIG.jerkSettleMs),
  gpsAccelWindowMs: z.number().positive(),
  maxLocationAccuracyM: z.number().positive(),
  impactFloorMps2: z.number().positive().default(DEFAULT_DETECTOR_CONFIG.impactFloorMps2),
  impactPeakMps2: z.number().positive().default(DEFAULT_DETECTOR_CONFIG.impactPeakMps2),
  impactPeakHighMps2: z.number().positive().default(DEFAULT_DETECTOR_CONFIG.impactPeakHighMps2),
  impactPulseMaxMs: z.number().positive().default(DEFAULT_DETECTOR_CONFIG.impactPulseMaxMs),
  impactSpeedDeltaMps: z.number().nonnegative().default(DEFAULT_DETECTOR_CONFIG.impactSpeedDeltaMps),
  impactLookaheadMs: z.number().positive().default(DEFAULT_DETECTOR_CONFIG.impactLookaheadMs),
  impactCooldownMs: z.number().nonnegative().default(DEFAULT_DETECTOR_CONFIG.impactCooldownMs),
  impactVerticalMax: z.number().min(0).max(1).default(DEFAULT_DETECTOR_CONFIG.impactVerticalMax),
  impactFreeFallMps2: z.number().positive().default(DEFAULT_DETECTOR_CONFIG.impactFreeFallMps2),
  impactFreeFallLookbackMs: z
    .number()
    .nonnegative()
    .default(DEFAULT_DETECTOR_CONFIG.impactFreeFallLookbackMs),
  impactRolloverDeg: z.number().positive().default(DEFAULT_DETECTOR_CONFIG.impactRolloverDeg),
  handheldTiltDeg: z.number().positive().default(DEFAULT_DETECTOR_CONFIG.handheldTiltDeg),
  handheldExitTiltDeg: z.number().positive().default(DEFAULT_DETECTOR_CONFIG.handheldExitTiltDeg),
  handheldGyroRadps: z.number().positive().default(DEFAULT_DETECTOR_CONFIG.handheldGyroRadps),
  handheldMotionMps2: z.number().positive().default(DEFAULT_DETECTOR_CONFIG.handheldMotionMps2),
  handheldQuietGyroRadps: z
    .number()
    .positive()
    .default(DEFAULT_DETECTOR_CONFIG.handheldQuietGyroRadps),
  handheldQuietMotionMps2: z
    .number()
    .positive()
    .default(DEFAULT_DETECTOR_CONFIG.handheldQuietMotionMps2),
  handheldStableMs: z.number().nonnegative().default(DEFAULT_DETECTOR_CONFIG.handheldStableMs),
  handheldConfirmMs: z.number().nonnegative().default(DEFAULT_DETECTOR_CONFIG.handheldConfirmMs),
  handheldExitMs: z.number().nonnegative().default(DEFAULT_DETECTOR_CONFIG.handheldExitMs),
  handheldCooldownMs: z.number().nonnegative().default(DEFAULT_DETECTOR_CONFIG.handheldCooldownMs),
  handheldBaselineAlpha: z
    .number()
    .positive()
    .max(1)
    .default(DEFAULT_DETECTOR_CONFIG.handheldBaselineAlpha),
    score: z.object({
      start: z.number(),
      harshAccel: z.number(),
      harshBrake: z.number(),
      harshCorner: z.number(),
      swerve: z.number().default(DEFAULT_DETECTOR_CONFIG.score.swerve),
      speeding: z.number(),
      jerk: z.number(),
      compound: z.number().default(DEFAULT_DETECTOR_CONFIG.score.compound),
      smoothAccel: z.number().nonnegative().default(DEFAULT_DETECTOR_CONFIG.score.smoothAccel),
      smoothBrake: z.number().nonnegative().default(DEFAULT_DETECTOR_CONFIG.score.smoothBrake),
      smoothCorner: z.number().nonnegative().default(DEFAULT_DETECTOR_CONFIG.score.smoothCorner),
      refDistanceKm: z.number().positive().default(DEFAULT_DETECTOR_CONFIG.score.refDistanceKm),
      refDurationMin: z.number().positive().default(DEFAULT_DETECTOR_CONFIG.score.refDurationMin),
      minDistanceKm: z.number().positive().default(DEFAULT_DETECTOR_CONFIG.score.minDistanceKm),
      minDurationMin: z.number().positive().default(DEFAULT_DETECTOR_CONFIG.score.minDurationMin),
    }),
});

export const tripTriggerSchema = z.enum(["manual", "auto"]);

/** Partial capture blocks parse; missing fields fill from DEFAULT_NATIVE_START_OPTIONS. */
export const nativeStartOptionsSchema = z
  .object({
    imuHz: z.number().optional(),
    locationIntervalMs: z.number().optional(),
    background: z.boolean().optional(),
    trigger: tripTriggerSchema.optional(),
  })
  .transform((value) => mergeNativeStartOptions(value));

export const sessionExportSchema = z.object({
  schemaVersion: z.literal(1),
  sessionId: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  config: detectorConfigSchema,
  location: z.array(locationSampleSchema),
  imu: z.array(imuSampleSchema),
  events: z.array(drivingEventSchema),
  metrics: z
    .object({
      distanceM: z.number().nonnegative(),
      durationMs: z.number().nonnegative(),
      maxSpeedMps: z.number().nullable(),
      avgSpeedMps: z.number().nullable(),
      score: z.number(),
      /** Absolute ledger. Absent on older JSON where `score` held the ledger. */
      points: z.number().optional(),
      eventCounts: z.object({
        harsh_accel: z.number().int().nonnegative(),
        harsh_brake: z.number().int().nonnegative(),
        harsh_corner: z.number().int().nonnegative(),
        swerve: z.number().int().nonnegative().default(0),
        speeding: z.number().int().nonnegative(),
        jerk: z.number().int().nonnegative(),
        possible_impact: z.number().int().nonnegative().default(0),
        phone_handheld: z.number().int().nonnegative().default(0),
        smooth_accel: z.number().int().nonnegative().default(0),
        smooth_brake: z.number().int().nonnegative().default(0),
        smooth_corner: z.number().int().nonnegative().default(0),
        smooth_km: z.number().int().nonnegative().default(0),
      }),
    })
    .transform((metrics) => {
      const points = metrics.points ?? metrics.score;
      return {
        ...metrics,
        points,
        score: relativeScore(points, metrics.distanceM),
      };
    }),
  device: z.object({
    platform: z.enum(["ios", "android", "web", "unknown"]),
    model: z.string().nullable(),
  }),
  /** Pre-auto-trip JSON omits this; fill manual so `schemaVersion` stays 1. */
  trigger: tripTriggerSchema.default("manual"),
  /** Original native capture options used to start the trip. Absent on pre-capture JSON. */
  capture: nativeStartOptionsSchema.optional(),
});

export function parseDetectorConfig(input: unknown): DetectorConfig {
  return mergeDetectorConfig(detectorConfigSchema.parse(input));
}

export function parseSessionExport(input: unknown): SessionExport {
  return sessionExportSchema.parse(input);
}
