import { magnitude } from "./geo.js";
import type { ImuSample, LocationSample } from "./types.js";

/** Vertical linear-accel RMS window assigned to each GPS sample. */
export const ROAD_WINDOW_MS = 1000;

export type AssessRoadOptions = {
  startedAtMs: number;
  jerkSettleMs: number;
  minSpeedMps: number;
  windowMs?: number;
};

/**
 * World-up linear acceleration (m/s²). Phone-Z is not “up” in a cup holder —
 * project onto the gravity vector when present.
 */
export function verticalLinearAccel(sample: ImuSample): number {
  const linear = sample.linearAccel;
  const accel = linear ?? sample.accel;
  const gravity = sample.gravity;
  if (gravity) {
    const mag = magnitude(gravity);
    if (mag > 0.5) {
      const projected =
        (accel.x * gravity.x + accel.y * gravity.y + accel.z * gravity.z) / mag;
      return Math.abs(linear ? projected : projected - mag);
    }
  }
  return Math.abs(linear ? linear.z : accel.z);
}

/**
 * Pavement roughness along the GPS track. Does not emit events or change score.
 * Idle / settle windows are `null`. When IMU is empty, existing `roadRmsMps2` is kept
 * so compact lab JSON (IMU dropped) still retunes without wiping the path measure.
 */
export function roadRmsForLocation(
  sample: LocationSample,
  imu: readonly ImuSample[],
  options: AssessRoadOptions,
): number | null {
  const windowMs = options.windowMs ?? ROAD_WINDOW_MS;
  const settleUntil = options.startedAtMs + options.jerkSettleMs;
  const speed = sample.speedMps ?? 0;
  if (sample.t < settleUntil || speed < options.minSpeedMps || imu.length === 0) {
    return null;
  }

  const lo = sample.t - windowMs;
  const hi = sample.t;
  let sumSq = 0;
  let n = 0;
  for (let i = imu.length - 1; i >= 0; i -= 1) {
    const imuSample = imu[i];
    if (!imuSample) {
      continue;
    }
    if (imuSample.t > hi) {
      continue;
    }
    if (imuSample.t < lo) {
      break;
    }
    if (imuSample.t < settleUntil) {
      continue;
    }
    const vertical = verticalLinearAccel(imuSample);
    sumSq += vertical * vertical;
    n += 1;
  }
  return n === 0 ? null : Math.sqrt(sumSq / n);
}

export function assessRoad(
  location: readonly LocationSample[],
  imu: readonly ImuSample[],
  options: AssessRoadOptions,
): LocationSample[] {
  const windowMs = options.windowMs ?? ROAD_WINDOW_MS;
  const settleUntil = options.startedAtMs + options.jerkSettleMs;

  if (imu.length === 0) {
    return location.map((sample) => ({
      ...sample,
      roadRmsMps2: sample.roadRmsMps2 ?? null,
    }));
  }

  const samples = [...imu].sort((a, b) => a.t - b.t);
  let start = 0;

  return location.map((sample) => {
    if (sample.roadRmsMps2 != null) {
      return sample;
    }
    const speed = sample.speedMps ?? 0;
    if (sample.t < settleUntil || speed < options.minSpeedMps) {
      return { ...sample, roadRmsMps2: null };
    }

    const lo = sample.t - windowMs;
    const hi = sample.t;
    while (start < samples.length && (samples[start]?.t ?? 0) < lo) {
      start += 1;
    }

    let sumSq = 0;
    let n = 0;
    for (let i = start; i < samples.length; i += 1) {
      const imuSample = samples[i];
      if (!imuSample || imuSample.t > hi) {
        break;
      }
      if (imuSample.t < settleUntil) {
        continue;
      }
      const vertical = verticalLinearAccel(imuSample);
      sumSq += vertical * vertical;
      n += 1;
    }

    return {
      ...sample,
      roadRmsMps2: n === 0 ? null : Math.sqrt(sumSq / n),
    };
  });
}
