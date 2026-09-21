import type { Vec3 } from "./types.js";

const EARTH_RADIUS_M = 6_371_000;

export function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export type SpeedFix = {
  t: number;
  lat: number;
  lon: number;
  speedMps?: number | null;
};

/**
 * Prefer GNSS `speedMps`. When the OS omits it (common on the first GPS fixes
 * and on sparse watch updates), infer from displacement / dt.
 */
export function derivedSpeedMps(
  from: SpeedFix | null | undefined,
  to: SpeedFix,
  maxDtSec = 60,
): number | null {
  const reported = to.speedMps;
  if (reported != null && Number.isFinite(reported) && reported >= 0) {
    return reported;
  }
  if (!from) {
    return null;
  }
  const dtSec = (to.t - from.t) / 1000;
  if (!Number.isFinite(dtSec) || dtSec < 0.05 || dtSec > maxDtSec) {
    return null;
  }
  const speed = haversineM(from, to) / dtSec;
  return Number.isFinite(speed) ? speed : null;
}

/** Too little movement for a stable displacement heading. */
export const DERIVED_COURSE_MIN_M = 2;

export type CourseFix = SpeedFix & {
  courseDeg?: number | null;
};

/**
 * Prefer GNSS `courseDeg`. When the OS omits bearing (common on fused /
 * network), use the initial bearing of the displacement.
 */
export function derivedCourseDeg(
  from: CourseFix | null | undefined,
  to: CourseFix,
  maxDtSec = 60,
  minDistanceM = DERIVED_COURSE_MIN_M,
): number | null {
  const reported = to.courseDeg;
  if (reported != null && Number.isFinite(reported)) {
    return wrapCourseDeg(reported);
  }
  if (!from) {
    return null;
  }
  const dtSec = (to.t - from.t) / 1000;
  if (!Number.isFinite(dtSec) || dtSec < 0.05 || dtSec > maxDtSec) {
    return null;
  }
  if (haversineM(from, to) < minDistanceM) {
    return null;
  }
  const y = Math.sin(toRad(to.lon - from.lon)) * Math.cos(toRad(to.lat));
  const x =
    Math.cos(toRad(from.lat)) * Math.sin(toRad(to.lat)) -
    Math.sin(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.cos(toRad(to.lon - from.lon));
  const deg = toDeg(Math.atan2(y, x));
  return Number.isFinite(deg) ? wrapCourseDeg(deg) : null;
}

export function haversineM(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function unwrapDeltaDeg(fromDeg: number, toDeg: number): number {
  let delta = toDeg - fromDeg;
  while (delta > 180) {
    delta -= 360;
  }
  while (delta < -180) {
    delta += 360;
  }
  return delta;
}

export function wrapCourseDeg(deg: number): number {
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

export function magnitude(vector: Vec3): number {
  return Math.hypot(vector.x, vector.y, vector.z);
}

export function mpsToKmh(mps: number): number {
  return mps * 3.6;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function severityFromPeak(peak: number, threshold: number): number {
  if (threshold <= 0) {
    return 1;
  }
  return clamp((peak - threshold) / threshold, 0, 1);
}
