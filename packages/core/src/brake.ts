import { magnitude } from "./geo.js";
import type { Vec3 } from "./types.js";

/** Speed that must be lost before a stop that has already ended can count. */
export const BRAKE_MIN_DROP_MPS = 2;

/** Path speed must stay under this fraction of the entry speed when the car has stopped. */
export const BRAKE_PATH_SPEED_X = 0.75;

/** Forward-axis load must hold this long before an IMU brake is real. */
export const IMU_BRAKE_HOLD_MS = 300;

/** A longer gap between IMU samples ends the hold. 25 Hz still fits. */
export const IMU_BRAKE_GAP_MS = 150;

/** GPS speed required before the phone-frame forward axis may be learned. */
export const IMU_BRAKE_LEARN_MIN_MPS = 3;

/** |GPS longitudinal| required so the learn step knows accel from brake. */
export const IMU_BRAKE_LEARN_MIN_MPS2 = 0.8;

/** Ignore a learn sample whose horizontal linear accel is only noise. */
export const IMU_BRAKE_MIN_HORIZONTAL_MPS2 = 0.5;

/** Slow blend of the learned forward unit vector. */
export const IMU_BRAKE_AXIS_ALPHA = 0.15;

/** Drop the learned axis when the phone tilts this far from the pose it was learned in. */
export const IMU_BRAKE_AXIS_TILT_DEG = 20;

/** IMU brake is allowed only if the car was moving this recently. */
export const IMU_BRAKE_RECENT_MS = 4000;

export type GpsBrakeSample = {
  longitudinal: number | null;
  entrySpeedMps: number | null;
  exitSpeedMps: number | null;
  dtSec: number | null;
  stepM: number | null;
};

/**
 * True when this GPS speed step is a harsh brake.
 * A fix that is still moving uses the rate alone. A fix that has already
 * stopped also needs a real drop and a path that slowed with it.
 */
export function gpsHarshBrakeQualifies(
  sample: GpsBrakeSample,
  minSpeedMps: number,
  harshBrakeMps2: number,
): boolean {
  const { longitudinal, entrySpeedMps, exitSpeedMps, dtSec, stepM } = sample;
  if (
    longitudinal == null ||
    entrySpeedMps == null ||
    exitSpeedMps == null ||
    !(longitudinal <= -harshBrakeMps2)
  ) {
    return false;
  }
  if (exitSpeedMps >= minSpeedMps) {
    return true;
  }
  if (entrySpeedMps < minSpeedMps) {
    return false;
  }
  if (entrySpeedMps - exitSpeedMps < BRAKE_MIN_DROP_MPS) {
    return false;
  }
  if (dtSec == null || stepM == null || !(dtSec > 0)) {
    return false;
  }
  return stepM / dtSec < entrySpeedMps * BRAKE_PATH_SPEED_X;
}

/** Linear accel with the gravity component removed. Missing gravity treats phone Z as up. */
export function horizontalLinear(linear: Vec3, gravity: Vec3 | null): Vec3 {
  if (!gravity) {
    return { x: linear.x, y: linear.y, z: 0 };
  }
  const g2 = gravity.x * gravity.x + gravity.y * gravity.y + gravity.z * gravity.z;
  if (g2 < 0.25) {
    return { x: linear.x, y: linear.y, z: linear.z };
  }
  const along = (linear.x * gravity.x + linear.y * gravity.y + linear.z * gravity.z) / g2;
  return {
    x: linear.x - gravity.x * along,
    y: linear.y - gravity.y * along,
    z: linear.z - gravity.z * along,
  };
}

/** Point the horizontal vector forward using the sign of GPS longitudinal. */
export function forwardSampleFromGps(horizontal: Vec3, gpsLongitudinal: number): Vec3 | null {
  if (Math.abs(gpsLongitudinal) < IMU_BRAKE_LEARN_MIN_MPS2) {
    return null;
  }
  if (magnitude(horizontal) < IMU_BRAKE_MIN_HORIZONTAL_MPS2) {
    return null;
  }
  const sign = gpsLongitudinal >= 0 ? 1 : -1;
  return {
    x: horizontal.x * sign,
    y: horizontal.y * sign,
    z: horizontal.z * sign,
  };
}

/** Blend a new forward sample into a unit axis. The first sample becomes the axis. */
export function blendForwardAxis(
  current: Vec3 | null,
  sample: Vec3,
  alpha = IMU_BRAKE_AXIS_ALPHA,
): Vec3 | null {
  const length = magnitude(sample);
  if (length < 1e-6) {
    return current;
  }
  const incoming = { x: sample.x / length, y: sample.y / length, z: sample.z / length };
  if (!current) {
    return incoming;
  }
  const mixed = {
    x: current.x * (1 - alpha) + incoming.x * alpha,
    y: current.y * (1 - alpha) + incoming.y * alpha,
    z: current.z * (1 - alpha) + incoming.z * alpha,
  };
  const mixedLength = magnitude(mixed);
  if (mixedLength < 1e-6) {
    return current;
  }
  return { x: mixed.x / mixedLength, y: mixed.y / mixedLength, z: mixed.z / mixedLength };
}

/** Positive when horizontal accel is opposite the learned forward axis (a brake). */
export function brakeAlongForward(horizontal: Vec3, forward: Vec3): number {
  return -(horizontal.x * forward.x + horizontal.y * forward.y + horizontal.z * forward.z);
}
