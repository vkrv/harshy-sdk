import { clamp, magnitude } from "./geo.js";
import type { DrivingEvent, ImuSample, ImpactDirection, LocationSample, Vec3 } from "./types.js";

export const POSSIBLE_IMPACT_TYPE = "possible_impact" as const;

/** Open a pulse above ~1.5 g. */
export const DEFAULT_IMPACT_FLOOR_MPS2 = 15;
/** Peak linear-accel magnitude to treat as crash-like (~3.5 g). */
export const DEFAULT_IMPACT_PEAK_MPS2 = 35;
/** Very large peak (~6 g) that can emit without a GPS speed change. */
export const DEFAULT_IMPACT_PEAK_HIGH_MPS2 = 59;
/** Longer than this is braking / accel, not a collision pulse. */
export const DEFAULT_IMPACT_PULSE_MAX_MS = 400;
/** |Δspeed| that corroborates an impact (~15 km/h). */
export const DEFAULT_IMPACT_SPEED_DELTA_MPS = 4;
export const DEFAULT_IMPACT_LOOKAHEAD_MS = 2000;
export const DEFAULT_IMPACT_COOLDOWN_MS = 5000;
/** Peak linear accel that is mostly world-up is a pothole, not an impact. */
export const DEFAULT_IMPACT_VERTICAL_MAX = 0.72;
/** Full |accel| below this in the lookback is free-fall (do not use linear accel). */
export const DEFAULT_IMPACT_FREE_FALL_MPS2 = 3;
export const DEFAULT_IMPACT_FREE_FALL_LOOKBACK_MS = 400;
export const DEFAULT_IMPACT_ROLLOVER_DEG = 50;

export type ImpactPulse = {
  startT: number;
  lastAboveT: number;
  peakT: number;
  peakMag: number;
  peakLinear: Vec3;
  gravityStart: Vec3 | null;
  gravityPeak: Vec3 | null;
  gravityLast: Vec3 | null;
};

export type PendingImpact = {
  t: number;
  peak: number;
  rollover: boolean;
  lat: number | null;
  lon: number | null;
  speedBeforeMps: number | null;
};

export type ImpactDetectorConfig = {
  impactFloorMps2: number;
  impactPeakMps2: number;
  impactPeakHighMps2: number;
  impactPulseMaxMs: number;
  impactSpeedDeltaMps: number;
  impactLookaheadMs: number;
  impactCooldownMs: number;
  impactVerticalMax: number;
  impactFreeFallMps2: number;
  impactFreeFallLookbackMs: number;
  impactRolloverDeg: number;
  jerkSettleMs: number;
  minSpeedMps: number;
  maxLocationAccuracyM: number;
};

function copyVec(vector: Vec3): Vec3 {
  return { x: vector.x, y: vector.y, z: vector.z };
}

/** Linear accel; fall back to accel − gravity, then raw accel. */
export function sampleLinearAccel(sample: ImuSample): Vec3 {
  if (sample.linearAccel) {
    return sample.linearAccel;
  }
  if (sample.gravity) {
    return {
      x: sample.accel.x - sample.gravity.x,
      y: sample.accel.y - sample.gravity.y,
      z: sample.accel.z - sample.gravity.z,
    };
  }
  return sample.accel;
}

/**
 * How much of the linear-accel vector is along gravity (0–1).
 * Missing gravity uses phone-Z as up.
 */
export function verticalShare(linear: Vec3, gravity: Vec3 | null): number {
  const accelMag = magnitude(linear);
  if (accelMag < 1e-6) {
    return 0;
  }
  if (!gravity) {
    return Math.abs(linear.z) / accelMag;
  }
  const gravityMag = magnitude(gravity);
  if (gravityMag < 0.5) {
    return 0;
  }
  return (
    Math.abs(linear.x * gravity.x + linear.y * gravity.y + linear.z * gravity.z) /
    (accelMag * gravityMag)
  );
}

export function gravityTiltDeg(from: Vec3 | null, to: Vec3 | null): number {
  if (!from || !to) {
    return 0;
  }
  const fromMag = magnitude(from);
  const toMag = magnitude(to);
  if (fromMag < 0.5 || toMag < 0.5) {
    return 0;
  }
  const dot = clamp(
    (from.x * to.x + from.y * to.y + from.z * to.z) / (fromMag * toMag),
    -1,
    1,
  );
  return (Math.acos(dot) * 180) / Math.PI;
}

export function locationSpeedUsable(
  sample: LocationSample,
  maxLocationAccuracyM: number,
): number | null {
  if (sample.speedMps == null) {
    return null;
  }
  if (sample.accuracyM != null && sample.accuracyM > maxLocationAccuracyM) {
    return null;
  }
  return sample.speedMps;
}

/** Most recent usable speed with `lo <= t <= hi`. */
export function lastUsableSpeedInWindow(
  location: readonly LocationSample[],
  lo: number,
  hi: number,
  maxLocationAccuracyM: number,
): number | null {
  for (let i = location.length - 1; i >= 0; i -= 1) {
    const sample = location[i];
    if (!sample || sample.t > hi) {
      continue;
    }
    if (sample.t < lo) {
      break;
    }
    const speed = locationSpeedUsable(sample, maxLocationAccuracyM);
    if (speed != null) {
      return speed;
    }
  }
  return null;
}

export function hadFreeFall(
  imu: readonly ImuSample[],
  pulseStartT: number,
  lookbackMs: number,
  freeFallMps2: number,
): boolean {
  const lo = pulseStartT - lookbackMs;
  for (let i = imu.length - 1; i >= 0; i -= 1) {
    const sample = imu[i];
    if (!sample || sample.t >= pulseStartT) {
      continue;
    }
    if (sample.t < lo) {
      break;
    }
    if (magnitude(sample.accel) < freeFallMps2) {
      return true;
    }
  }
  return false;
}

export function classifyImpactDirection(args: {
  rollover: boolean;
  speedDeltaMps: number | null;
  speedDeltaMin: number;
}): ImpactDirection {
  if (args.rollover) {
    return "rollover";
  }
  if (args.speedDeltaMps == null || args.speedDeltaMin <= 0) {
    return "unknown";
  }
  if (args.speedDeltaMps <= -args.speedDeltaMin) {
    return "front";
  }
  if (args.speedDeltaMps >= args.speedDeltaMin) {
    return "rear";
  }
  return "unknown";
}

export function isPossibleImpact(
  event: Pick<DrivingEvent, "type">,
): event is DrivingEvent & { type: "possible_impact" } {
  return event.type === POSSIBLE_IMPACT_TYPE;
}

/** Host-facing axis label. Not a body panel or cabin seat. */
export function impactDirectionLabel(direction: string | null | undefined): string {
  if (direction === "front") {
    return "Front";
  }
  if (direction === "rear") {
    return "Rear";
  }
  if (direction === "rollover") {
    return "Rollover";
  }
  return "Direction unknown";
}

export function advanceImpactPulse(
  pulse: ImpactPulse | null,
  sample: ImuSample,
  floorMps2: number,
): { pulse: ImpactPulse | null; closed: ImpactPulse | null } {
  const linear = sampleLinearAccel(sample);
  const mag = magnitude(linear);
  if (mag >= floorMps2) {
    if (!pulse) {
      return {
        pulse: {
          startT: sample.t,
          lastAboveT: sample.t,
          peakT: sample.t,
          peakMag: mag,
          peakLinear: copyVec(linear),
          gravityStart: sample.gravity ? copyVec(sample.gravity) : null,
          gravityPeak: sample.gravity ? copyVec(sample.gravity) : null,
          gravityLast: sample.gravity ? copyVec(sample.gravity) : null,
        },
        closed: null,
      };
    }
    const next = {
      ...pulse,
      lastAboveT: sample.t,
      gravityLast: sample.gravity ? copyVec(sample.gravity) : pulse.gravityLast,
    };
    if (mag > pulse.peakMag) {
      next.peakMag = mag;
      next.peakT = sample.t;
      next.peakLinear = copyVec(linear);
      next.gravityPeak = sample.gravity ? copyVec(sample.gravity) : pulse.gravityPeak;
    }
    return { pulse: next, closed: null };
  }
  if (pulse) {
    return { pulse: null, closed: pulse };
  }
  return { pulse: null, closed: null };
}

export type ClosedPulseDecision = { kind: "reject" } | { kind: "pending"; pending: PendingImpact };

export function decideClosedPulse(args: {
  pulse: ImpactPulse;
  imu: readonly ImuSample[];
  location: readonly LocationSample[];
  lastLat: number | null;
  lastLon: number | null;
  startedAtMs: number;
  lastImpactAt: number | undefined;
  config: ImpactDetectorConfig;
}): ClosedPulseDecision {
  const { pulse, config } = args;
  const width = pulse.lastAboveT - pulse.startT;
  if (width > config.impactPulseMaxMs) {
    return { kind: "reject" };
  }
  if (pulse.peakMag < config.impactPeakMps2) {
    return { kind: "reject" };
  }
  if (pulse.startT - args.startedAtMs < config.jerkSettleMs) {
    return { kind: "reject" };
  }
  if (
    args.lastImpactAt != null &&
    pulse.peakT - args.lastImpactAt < config.impactCooldownMs
  ) {
    return { kind: "reject" };
  }
  if (
    hadFreeFall(
      args.imu,
      pulse.startT,
      config.impactFreeFallLookbackMs,
      config.impactFreeFallMps2,
    )
  ) {
    return { kind: "reject" };
  }
  if (verticalShare(pulse.peakLinear, pulse.gravityPeak) > config.impactVerticalMax) {
    return { kind: "reject" };
  }

  const speedBefore = lastUsableSpeedInWindow(
    args.location,
    pulse.peakT - config.impactLookaheadMs,
    pulse.peakT,
    config.maxLocationAccuracyM,
  );
  if (speedBefore == null || speedBefore < config.minSpeedMps) {
    return { kind: "reject" };
  }

  const rollover =
    gravityTiltDeg(pulse.gravityStart, pulse.gravityLast ?? pulse.gravityPeak) >=
    config.impactRolloverDeg;

  return {
    kind: "pending",
    pending: {
      t: pulse.peakT,
      peak: pulse.peakMag,
      rollover,
      lat: args.lastLat,
      lon: args.lastLon,
      speedBeforeMps: speedBefore,
    },
  };
}

export type PendingImpactDecision =
  | { kind: "wait" }
  | { kind: "discard" }
  | { kind: "emit"; direction: ImpactDirection; speedMps: number | null };

export function decidePendingImpact(args: {
  pending: PendingImpact;
  location: readonly LocationSample[];
  now: number;
  force: boolean;
  config: ImpactDetectorConfig;
}): PendingImpactDecision {
  const { pending, config } = args;
  const speedAfter = lastUsableSpeedInWindow(
    args.location,
    pending.t + 1,
    pending.t + config.impactLookaheadMs,
    config.maxLocationAccuracyM,
  );
  const speedDelta =
    pending.speedBeforeMps != null && speedAfter != null
      ? speedAfter - pending.speedBeforeMps
      : null;
  const gpsConfirms =
    speedDelta != null &&
    config.impactSpeedDeltaMps > 0 &&
    Math.abs(speedDelta) >= config.impactSpeedDeltaMps;
  const skipGps = config.impactSpeedDeltaMps <= 0;
  const highPeak = pending.peak >= config.impactPeakHighMps2;
  const lookaheadElapsed = args.now >= pending.t + config.impactLookaheadMs;

  if (pending.rollover || gpsConfirms || highPeak || skipGps) {
    return {
      kind: "emit",
      direction: classifyImpactDirection({
        rollover: pending.rollover,
        speedDeltaMps: speedDelta,
        speedDeltaMin: config.impactSpeedDeltaMps,
      }),
      speedMps: speedAfter ?? pending.speedBeforeMps,
    };
  }

  if (lookaheadElapsed || args.force) {
    return { kind: "discard" };
  }
  return { kind: "wait" };
}
