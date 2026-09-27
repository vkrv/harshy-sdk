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

/**
 * Chip bearing and track bearing farther apart than this are not the same turn.
 * A larger gap needs the mounted phone's vertical gyro before the chip yaw counts.
 */
export const YAW_COURSE_DISAGREE_DEG = 45;

/** Mounted gyro about gravity must be at least this fraction of the chip yaw. */
export const YAW_GYRO_CONFIRM_RATIO = 0.5;

/** And not several times larger — a phone shake is not that turn. */
export const YAW_GYRO_CONFIRM_MAX_RATIO = 2.5;

export type CourseFix = SpeedFix & {
  courseDeg?: number | null;
};

/**
 * Initial bearing of the displacement. Ignores any chip course on the fix.
 * Returns null when the step is shorter than `minDistanceM`.
 */
export function pathBearingDeg(
  from: { lat: number; lon: number } | null | undefined,
  to: { lat: number; lon: number },
  minDistanceM = DERIVED_COURSE_MIN_M,
): number | null {
  if (!from || haversineM(from, to) < minDistanceM) {
    return null;
  }
  const y = Math.sin(toRad(to.lon - from.lon)) * Math.cos(toRad(to.lat));
  const x =
    Math.cos(toRad(from.lat)) * Math.sin(toRad(to.lat)) -
    Math.sin(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.cos(toRad(to.lon - from.lon));
  const deg = toDeg(Math.atan2(y, x));
  return Number.isFinite(deg) ? wrapCourseDeg(deg) : null;
}

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
  return pathBearingDeg(from, to, minDistanceM);
}

/** Signed rotation about the gravity axis (rad/s). Null without gyro and gravity. */
export function verticalGyroRadps(
  gyro: Vec3 | null | undefined,
  gravity: Vec3 | null | undefined,
): number | null {
  if (!gyro || !gravity) {
    return null;
  }
  const g = magnitude(gravity);
  if (g < 0.5) {
    return null;
  }
  const about = (gyro.x * gravity.x + gyro.y * gravity.y + gyro.z * gravity.z) / g;
  return Number.isFinite(about) ? about : null;
}

function finiteDeg(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

function gyroConfirmsChipYaw(
  chipOmega: number,
  gyro: number | null,
  phoneHandheld: boolean,
): boolean {
  if (phoneHandheld || gyro == null || !Number.isFinite(gyro)) {
    return false;
  }
  const chip = Math.abs(chipOmega);
  const spin = Math.abs(gyro);
  if (chip < 1e-6) {
    return spin < 0.05;
  }
  return spin >= chip * YAW_GYRO_CONFIRM_RATIO && spin <= chip * YAW_GYRO_CONFIRM_MAX_RATIO;
}

/**
 * Yaw rate (rad/s) for corner and swerve. The track heading wins when both
 * steps are long enough to have one. A chip course that disagrees with that
 * track counts only when a mounted phone is rotating about gravity with it.
 * With no track heading, the chip course needs that same gyro confirmation.
 */
export function confirmedYawRadps(input: {
  dtSec: number;
  chipFromDeg: number | null;
  chipToDeg: number | null;
  pathFromDeg: number | null;
  pathToDeg: number | null;
  verticalGyroRadps: number | null;
  phoneHandheld: boolean;
}): number | null {
  const { dtSec } = input;
  if (!Number.isFinite(dtSec) || dtSec <= 0) {
    return null;
  }
  const chipDelta =
    finiteDeg(input.chipFromDeg) && finiteDeg(input.chipToDeg)
      ? unwrapDeltaDeg(input.chipFromDeg, input.chipToDeg)
      : null;
  const pathDelta =
    finiteDeg(input.pathFromDeg) && finiteDeg(input.pathToDeg)
      ? unwrapDeltaDeg(input.pathFromDeg, input.pathToDeg)
      : null;
  const chipOmega = chipDelta == null ? null : toRad(chipDelta) / dtSec;
  const pathOmega = pathDelta == null ? null : toRad(pathDelta) / dtSec;

  if (pathOmega != null && chipOmega != null && chipDelta != null && pathDelta != null) {
    if (Math.abs(chipDelta - pathDelta) <= YAW_COURSE_DISAGREE_DEG) {
      return pathOmega;
    }
    if (gyroConfirmsChipYaw(chipOmega, input.verticalGyroRadps, input.phoneHandheld)) {
      return chipOmega;
    }
    return pathOmega;
  }
  if (pathOmega != null) {
    return pathOmega;
  }
  if (chipOmega != null && gyroConfirmsChipYaw(chipOmega, input.verticalGyroRadps, input.phoneHandheld)) {
    return chipOmega;
  }
  return null;
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
