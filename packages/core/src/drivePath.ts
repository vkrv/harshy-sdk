import { haversineM } from "./geo.js";
import type { LocationSample } from "./types.js";

/** Reject steps faster than this unless GPS reports higher (with margin). */
export const DRIVE_FIX_MAX_SPEED_MPS = 55;

/** Absolute step cap when timestamps are missing (~200 km/h at 1 Hz). */
export const DRIVE_FIX_MAX_STEP_M = 80;

/** After this many consecutive rejects, accept the next fix as a new segment. */
export const DRIVE_FIX_RESET_AFTER = 10;

/** Minimum outbound distance before out-and-back spike detection (batch / display). */
export const DRIVE_FIX_SPIKE_MIN_M = 25;

/**
 * Drop a vertex when out+back exceeds this × the direct bridge
 * (classic GPS spike that leaves the road and returns).
 */
export const DRIVE_FIX_SPIKE_RATIO = 2.5;

/**
 * Lat/lon printed with this many fractional digits or fewer, plus null speed,
 * matches Android network/cell injects seen in recorded trips.
 */
export const DRIVE_FIX_COARSE_FRACTION_DIGITS = 7;

/** GNSS-quality horizontal accuracy — not a cell/Wi‑Fi inject. */
export const DRIVE_FIX_GNSS_ACCURACY_M = 50;

export type DriveFixPoint = {
  lat: number;
  lon: number;
  t?: number | null;
  speedMps?: number | null;
  accuracyM?: number | null;
};

export type DriveFixOptions = {
  maxSpeedMps?: number;
  maxStepM?: number;
  spikeMinM?: number;
  spikeRatio?: number;
  resetAfter?: number;
};

/** Fractional decimal digits as JSON/JS typically print the number. */
export function coordinateFractionDigits(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const text = String(value);
  const dot = text.indexOf(".");
  if (dot < 0) {
    return 0;
  }
  return text.length - dot - 1;
}

/**
 * Network/cell-style inject: no speed, coarse lat/lon (≤7 fractional digits),
 * and not GNSS-quality accuracy. GPS often omits speed on the first fixes
 * while still reporting 5–20 m accuracy — those must enter the trip.
 * Does not use segment-reset — true injects should never become the path anchor.
 */
export function isCoarseNetworkLikeFix(sample: DriveFixPoint): boolean {
  if (sample.speedMps != null) {
    return false;
  }
  const accuracy = sample.accuracyM;
  if (accuracy != null && Number.isFinite(accuracy) && accuracy <= DRIVE_FIX_GNSS_ACCURACY_M) {
    return false;
  }
  return (
    coordinateFractionDigits(sample.lat) <= DRIVE_FIX_COARSE_FRACTION_DIGITS ||
    coordinateFractionDigits(sample.lon) <= DRIVE_FIX_COARSE_FRACTION_DIGITS
  );
}

function stepLimitM(
  from: DriveFixPoint,
  to: DriveFixPoint,
  maxSpeedMps: number,
  maxStepM: number,
): number {
  const dtMs =
    from.t != null && to.t != null && Number.isFinite(from.t) && Number.isFinite(to.t)
      ? Math.max(0, to.t - from.t)
      : null;
  if (dtMs == null) {
    return maxStepM;
  }
  const dtSec = Math.max(dtMs / 1000, 0.05);
  const reported = Math.max(from.speedMps ?? 0, to.speedMps ?? 0);
  const cap = Math.max(maxSpeedMps, reported * 1.35 + 8);
  return cap * dtSec;
}

/** True when the step from `from` → `to` is a plausible on-road GPS update. */
export function isPlausibleDriveStep(
  from: DriveFixPoint,
  to: DriveFixPoint,
  options: Pick<DriveFixOptions, "maxSpeedMps" | "maxStepM"> = {},
): boolean {
  const maxSpeedMps = options.maxSpeedMps ?? DRIVE_FIX_MAX_SPEED_MPS;
  const maxStepM = options.maxStepM ?? DRIVE_FIX_MAX_STEP_M;
  return haversineM(from, to) <= stepLimitM(from, to, maxSpeedMps, maxStepM);
}

export function isDrivePathSpike(
  prev: DriveFixPoint,
  cur: DriveFixPoint,
  next: DriveFixPoint,
  options: Pick<DriveFixOptions, "spikeMinM" | "spikeRatio"> = {},
): boolean {
  const spikeMinM = options.spikeMinM ?? DRIVE_FIX_SPIKE_MIN_M;
  const spikeRatio = options.spikeRatio ?? DRIVE_FIX_SPIKE_RATIO;
  const out = haversineM(prev, cur);
  if (out < spikeMinM) {
    return false;
  }
  const back = haversineM(cur, next);
  const bridge = haversineM(prev, next);
  if (bridge < 1) {
    return out > spikeMinM;
  }
  return out + back > spikeRatio * bridge && out > bridge;
}

/**
 * Batch filter for already-recorded paths (legacy History / Maps).
 * Live capture rejects in {@link shouldAcceptDriveFix} / `pushLocation`.
 */
export function compensateDrivePath<T extends DriveFixPoint>(
  points: readonly T[],
  options: DriveFixOptions = {},
): T[] {
  if (points.length === 0) {
    return [];
  }
  if (points.length === 1) {
    const only = points[0];
    return only != null && !isCoarseNetworkLikeFix(only) ? [only] : [];
  }

  const resetAfter = options.resetAfter ?? DRIVE_FIX_RESET_AFTER;
  const kept: T[] = [];
  let rejects = 0;

  for (let i = 0; i < points.length; i += 1) {
    const cur = points[i];
    if (cur == null) {
      continue;
    }
    if (isCoarseNetworkLikeFix(cur)) {
      continue;
    }
    if (kept.length === 0) {
      kept.push(cur);
      continue;
    }

    const prev = kept[kept.length - 1];
    if (prev == null) {
      kept.push(cur);
      continue;
    }

    const next = points[i + 1];
    if (next != null && isDrivePathSpike(prev, cur, next, options)) {
      rejects += 1;
      if (rejects >= resetAfter) {
        kept.push(cur);
        rejects = 0;
      }
      continue;
    }

    if (!isPlausibleDriveStep(prev, cur, options)) {
      rejects += 1;
      if (rejects >= resetAfter) {
        kept.push(cur);
        rejects = 0;
      }
      continue;
    }

    kept.push(cur);
    rejects = 0;
  }

  return kept;
}

/** Whether `sample` should be appended after `anchor` (or accepted as a reset). */
export function shouldAcceptDriveFix(
  anchor: DriveFixPoint | null,
  sample: DriveFixPoint,
  consecutiveRejects: number,
  options: DriveFixOptions = {},
): { accept: boolean; rejects: number } {
  if (isCoarseNetworkLikeFix(sample)) {
    return { accept: false, rejects: consecutiveRejects };
  }
  if (anchor == null) {
    return { accept: true, rejects: 0 };
  }
  if (isPlausibleDriveStep(anchor, sample, options)) {
    return { accept: true, rejects: 0 };
  }
  const resetAfter = options.resetAfter ?? DRIVE_FIX_RESET_AFTER;
  const rejects = consecutiveRejects + 1;
  if (rejects >= resetAfter) {
    return { accept: true, rejects: 0 };
  }
  return { accept: false, rejects };
}

export function lastLocationAnchor(
  location: readonly LocationSample[],
): LocationSample | null {
  return location.length === 0 ? null : (location[location.length - 1] ?? null);
}
