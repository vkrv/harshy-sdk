import { magnitude, severityFromPeak } from "./geo.js";
import { harshEventLevel } from "./harsh.js";
import { gravityTiltDeg, sampleLinearAccel } from "./impact.js";
import type { DrivingEvent, ImuSample, LocationSample, Vec3 } from "./types.js";

export const PHONE_HANDHELD_TYPE = "phone_handheld" as const;

/** Gravity tilt from the mount baseline that starts a pickup (degrees). */
export const DEFAULT_HANDHELD_TILT_DEG = 35;
/** Close the span when tilt stays below this. */
export const DEFAULT_HANDHELD_EXIT_TILT_DEG = 18;
/** Gyro magnitude that counts as handling (~70°/s). */
export const DEFAULT_HANDHELD_GYRO_RADPS = 1.2;
/** Linear-accel magnitude that counts as handling. */
export const DEFAULT_HANDHELD_MOTION_MPS2 = 2;
/** Quiet enough to refresh the mount baseline. */
export const DEFAULT_HANDHELD_QUIET_GYRO_RADPS = 0.25;
export const DEFAULT_HANDHELD_QUIET_MOTION_MPS2 = 0.8;
/** How long the phone must stay quiet before the baseline locks / updates. */
export const DEFAULT_HANDHELD_STABLE_MS = 800;
/** Pickup must stay tilted + handling this long before opening a span. */
export const DEFAULT_HANDHELD_CONFIRM_MS = 350;
/** How long tilt must stay below exit (or the car stopped) before closing. */
export const DEFAULT_HANDHELD_EXIT_MS = 700;
/** Gap after a closed span before another can open. */
export const DEFAULT_HANDHELD_COOLDOWN_MS = 2500;
/** EMA toward gravity while the phone is docked and quiet. */
export const DEFAULT_HANDHELD_BASELINE_ALPHA = 0.08;

export type HandheldDetectorConfig = {
  handheldTiltDeg: number;
  handheldExitTiltDeg: number;
  handheldGyroRadps: number;
  handheldMotionMps2: number;
  handheldQuietGyroRadps: number;
  handheldQuietMotionMps2: number;
  handheldStableMs: number;
  handheldConfirmMs: number;
  handheldExitMs: number;
  handheldCooldownMs: number;
  handheldBaselineAlpha: number;
  jerkSettleMs: number;
  harshMediumX: number;
  harshHeavyX: number;
};

export type HandheldFilter = {
  baseline: Vec3 | null;
  quietSince: number | null;
  candidateSince: number | null;
  belowExitSince: number | null;
};

export function emptyHandheldFilter(): HandheldFilter {
  return {
    baseline: null,
    quietSince: null,
    candidateSince: null,
    belowExitSince: null,
  };
}

function copyVec(vector: Vec3): Vec3 {
  return { x: vector.x, y: vector.y, z: vector.z };
}

function blendBaseline(previous: Vec3 | null, gravity: Vec3, alpha: number): Vec3 {
  if (!previous) {
    return copyVec(gravity);
  }
  return {
    x: previous.x + (gravity.x - previous.x) * alpha,
    y: previous.y + (gravity.y - previous.y) * alpha,
    z: previous.z + (gravity.z - previous.z) * alpha,
  };
}

export function isPhoneHandheld(
  event: Pick<DrivingEvent, "type">,
): event is DrivingEvent & { type: "phone_handheld" } {
  return event.type === PHONE_HANDHELD_TYPE;
}

export type HandheldStep = {
  filter: HandheldFilter;
  open: DrivingEvent | null;
  /** Newly opened, updated, or closed span (hosts stream this). */
  emitted: DrivingEvent | null;
  lastClosedAt: number | undefined;
};

/**
 * Mount baseline + pickup/hold while the vehicle is moving.
 * Open on sustained gravity tilt with handling motion; stay open while tilted;
 * close when the phone returns toward the mount (or the car stops).
 * Peak is gravity tilt in degrees. Not a score event.
 */
export function advanceHandheld(args: {
  filter: HandheldFilter;
  open: DrivingEvent | null;
  lastClosedAt: number | undefined;
  sample: ImuSample;
  moving: boolean;
  speedMps: number | null;
  location: LocationSample | null;
  startedAtMs: number;
  config: HandheldDetectorConfig;
}): HandheldStep {
  const { sample, config } = args;
  const gravity = sample.gravity;
  const filter: HandheldFilter = { ...args.filter };
  let open = args.open;
  let lastClosedAt = args.lastClosedAt;
  let emitted: DrivingEvent | null = null;

  if (!gravity || magnitude(gravity) < 0.5) {
    return { filter, open, emitted, lastClosedAt };
  }

  const gyroMag = sample.gyro ? magnitude(sample.gyro) : 0;
  const linearMag = magnitude(sampleLinearAccel(sample));
  const quiet =
    gyroMag < config.handheldQuietGyroRadps && linearMag < config.handheldQuietMotionMps2;

  if (!open && quiet) {
    if (filter.quietSince == null) {
      filter.quietSince = sample.t;
    }
    if (sample.t - filter.quietSince >= config.handheldStableMs) {
      filter.baseline = blendBaseline(
        filter.baseline,
        gravity,
        filter.baseline ? config.handheldBaselineAlpha : 1,
      );
    }
  } else if (!open) {
    filter.quietSince = null;
  }

  const settled = sample.t - args.startedAtMs >= config.jerkSettleMs;
  if (!settled || !filter.baseline) {
    filter.candidateSince = null;
    return { filter, open, emitted, lastClosedAt };
  }

  const tilt = gravityTiltDeg(filter.baseline, gravity);

  if (open) {
    if (tilt > open.peak) {
      open.peak = tilt;
      open.severity = severityFromPeak(tilt, config.handheldTiltDeg);
      open.level = harshEventLevel(
        tilt,
        config.handheldTiltDeg,
        config.harshMediumX,
        config.harshHeavyX,
      );
      open.lat = args.location?.lat ?? open.lat;
      open.lon = args.location?.lon ?? open.lon;
      open.speedMps = args.speedMps;
      emitted = open;
    }
    const shouldExit = !args.moving || tilt < config.handheldExitTiltDeg;
    if (shouldExit) {
      if (filter.belowExitSince == null) {
        filter.belowExitSince = sample.t;
      }
      if (sample.t - filter.belowExitSince >= config.handheldExitMs) {
        open.endT = sample.t;
        lastClosedAt = sample.t;
        emitted = open;
        open = null;
        filter.candidateSince = null;
        filter.belowExitSince = null;
        filter.quietSince = null;
      }
    } else {
      filter.belowExitSince = null;
    }
    return { filter, open, emitted, lastClosedAt };
  }

  if (!args.moving) {
    filter.candidateSince = null;
    filter.belowExitSince = null;
    return { filter, open, emitted, lastClosedAt };
  }

  if (
    lastClosedAt != null &&
    sample.t - lastClosedAt < config.handheldCooldownMs
  ) {
    filter.candidateSince = null;
    return { filter, open, emitted, lastClosedAt };
  }

  const handling =
    gyroMag >= config.handheldGyroRadps || linearMag >= config.handheldMotionMps2;
  if (tilt >= config.handheldTiltDeg && handling && filter.candidateSince == null) {
    filter.candidateSince = sample.t;
  }
  if (filter.candidateSince != null && tilt >= config.handheldTiltDeg) {
    if (sample.t - filter.candidateSince >= config.handheldConfirmMs) {
      open = {
        id: `${PHONE_HANDHELD_TYPE}-${sample.t}`,
        type: PHONE_HANDHELD_TYPE,
        t: filter.candidateSince,
        endT: null,
        peak: tilt,
        severity: severityFromPeak(tilt, config.handheldTiltDeg),
        level: harshEventLevel(
          tilt,
          config.handheldTiltDeg,
          config.harshMediumX,
          config.harshHeavyX,
        ),
        lat: args.location?.lat ?? null,
        lon: args.location?.lon ?? null,
        speedMps: args.speedMps,
        overlaps: [],
      };
      emitted = open;
      filter.candidateSince = null;
      filter.belowExitSince = null;
    }
  } else {
    filter.candidateSince = null;
  }

  return { filter, open, emitted, lastClosedAt };
}

export function closeHandheldSpan(
  open: DrivingEvent | null,
  t: number,
): DrivingEvent | null {
  if (!open || open.endT != null) {
    return null;
  }
  open.endT = t;
  return open;
}
