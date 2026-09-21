import { unwrapDeltaDeg, wrapCourseDeg } from "./geo.js";

/** Two agreeing GPS fixes before the live heading is shown. */
export const HEADING_CONFIRM_SAMPLES = 2;
/** Junk course while "moving" is often a 90°+ jump; a real turn is smaller per fix. */
export const HEADING_CONFIRM_BAND_DEG = 35;
/** Circular EMA time constant for live heading (not used for swerve). */
export const HEADING_SMOOTH_TAU_MS = 800;
/** Do not republish until smoothed heading has moved this far. */
export const HEADING_PUBLISH_DEG = 3;

export type HeadingFilter = {
  headingDeg: number | null;
  smoothedDeg: number | null;
  atMs: number | null;
  pendingDeg: number | null;
  pendingCount: number;
  held: boolean;
};

export function emptyHeadingFilter(): HeadingFilter {
  return {
    headingDeg: null,
    smoothedDeg: null,
    atMs: null,
    pendingDeg: null,
    pendingCount: 0,
    held: false,
  };
}

/**
 * Live heading only. GPS course at rest is noise; keep raw `courseDeg` for swerve.
 * Blank until `minSpeedMps` with two agreeing samples; circular EMA while moving;
 * hold the last published value when stopped.
 */
export function advanceHeadingFilter(
  prev: HeadingFilter,
  sample: { t: number; courseDeg: number | null; speedMps: number | null },
  minSpeedMps: number,
): HeadingFilter {
  const course = sample.courseDeg;
  if (course == null || !Number.isFinite(course)) {
    return prev;
  }
  const courseDeg = wrapCourseDeg(course);
  const moving = sample.speedMps != null && sample.speedMps >= minSpeedMps;
  if (!moving) {
    return {
      headingDeg: prev.headingDeg,
      smoothedDeg: prev.smoothedDeg,
      atMs: prev.atMs,
      pendingDeg: null,
      pendingCount: 0,
      held: prev.headingDeg != null,
    };
  }

  const needsConfirm = prev.headingDeg == null || prev.held;
  if (needsConfirm) {
    const stepped = stepConfirm(prev.pendingDeg, prev.pendingCount, courseDeg);
    if (stepped.confirmedDeg == null) {
      return {
        ...prev,
        pendingDeg: stepped.pendingDeg,
        pendingCount: stepped.pendingCount,
      };
    }
    return {
      headingDeg: maybePublish(prev.headingDeg, stepped.confirmedDeg),
      smoothedDeg: stepped.confirmedDeg,
      atMs: sample.t,
      pendingDeg: null,
      pendingCount: 0,
      held: false,
    };
  }

  const from = prev.smoothedDeg ?? prev.headingDeg ?? courseDeg;
  const dtMs = prev.atMs == null ? HEADING_SMOOTH_TAU_MS : Math.max(0, sample.t - prev.atMs);
  const smoothedDeg = smoothToward(from, courseDeg, dtMs);
  return {
    headingDeg: maybePublish(prev.headingDeg, smoothedDeg),
    smoothedDeg,
    atMs: sample.t,
    pendingDeg: null,
    pendingCount: 0,
    held: false,
  };
}

function stepConfirm(
  pendingDeg: number | null,
  pendingCount: number,
  courseDeg: number,
): { pendingDeg: number; pendingCount: number; confirmedDeg: number | null } {
  if (pendingDeg == null || pendingCount <= 0) {
    return { pendingDeg: courseDeg, pendingCount: 1, confirmedDeg: null };
  }
  const delta = unwrapDeltaDeg(pendingDeg, courseDeg);
  if (Math.abs(delta) > HEADING_CONFIRM_BAND_DEG) {
    return { pendingDeg: courseDeg, pendingCount: 1, confirmedDeg: null };
  }
  const blended = wrapCourseDeg(pendingDeg + delta / 2);
  const count = pendingCount + 1;
  if (count < HEADING_CONFIRM_SAMPLES) {
    return { pendingDeg: blended, pendingCount: count, confirmedDeg: null };
  }
  return { pendingDeg: blended, pendingCount: 0, confirmedDeg: blended };
}

function smoothToward(fromDeg: number, toDeg: number, dtMs: number): number {
  const alpha = dtMs <= 0 ? 1 : 1 - Math.exp(-dtMs / HEADING_SMOOTH_TAU_MS);
  return wrapCourseDeg(fromDeg + alpha * unwrapDeltaDeg(fromDeg, toDeg));
}

function maybePublish(published: number | null, smoothed: number): number {
  if (published == null) {
    return smoothed;
  }
  if (Math.abs(unwrapDeltaDeg(published, smoothed)) >= HEADING_PUBLISH_DEG) {
    return smoothed;
  }
  return published;
}
