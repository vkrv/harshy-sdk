import {
  imuSampleSchema,
  locationSampleSchema,
  type ImuSample,
  type LocationSample,
  type MotionActivity,
  type WatchFix,
} from "@harshy/core";

const MOTION_ACTIVITIES = new Set<MotionActivity>([
  "automotive",
  "cycling",
  "walking",
  "running",
  "stationary",
  "unknown",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null) {
    return value as Record<string, unknown>;
  }
  return null;
}

function normalizeLocation(sample: {
  t: number;
  lat: number;
  lon: number;
  altitudeM?: number | null;
  speedMps?: number | null;
  courseDeg?: number | null;
  accuracyM?: number | null;
  altitudeAccuracyM?: number | null;
  roadRmsMps2?: number | null;
}): LocationSample {
  return {
    t: sample.t,
    lat: sample.lat,
    lon: sample.lon,
    altitudeM: sample.altitudeM ?? null,
    speedMps: sample.speedMps ?? null,
    courseDeg: sample.courseDeg ?? null,
    accuracyM: sample.accuracyM ?? null,
    altitudeAccuracyM: sample.altitudeAccuracyM ?? null,
    ...(typeof sample.roadRmsMps2 === "number" ? { roadRmsMps2: sample.roadRmsMps2 } : {}),
  };
}

export function parseLocationSample(value: unknown): LocationSample | null {
  const parsed = locationSampleSchema.safeParse(value);
  if (parsed.success) {
    return normalizeLocation(parsed.data);
  }

  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const t = asFiniteNumber(record.t);
  const lat = asFiniteNumber(record.lat);
  const lon = asFiniteNumber(record.lon);
  if (t == null || lat == null || lon == null) {
    return null;
  }
  const fallback = {
    t,
    lat,
    lon,
    altitudeM: asFiniteNumber(record.altitudeM),
    speedMps: asFiniteNumber(record.speedMps),
    courseDeg: asFiniteNumber(record.courseDeg),
    accuracyM: asFiniteNumber(record.accuracyM),
    altitudeAccuracyM: asFiniteNumber(record.altitudeAccuracyM),
    roadRmsMps2: asFiniteNumber(record.roadRmsMps2) ?? undefined,
  };
  const retry = locationSampleSchema.safeParse(fallback);
  return retry.success ? normalizeLocation(retry.data) : null;
}

export function parseImuSample(value: unknown): ImuSample | null {
  const parsed = imuSampleSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  const record = asRecord(value);
  if (!record || typeof record.t !== "number") {
    return null;
  }
  const accel = asRecord(record.accel);
  if (!accel) {
    return null;
  }
  const fallback = {
    t: record.t,
    accel: {
      x: Number(accel.x ?? 0),
      y: Number(accel.y ?? 0),
      z: Number(accel.z ?? 0),
    },
    linearAccel: null,
    gyro: null,
    magnetometer: null,
    attitude: null,
    gravity: null,
    barometerHpa: typeof record.barometerHpa === "number" ? record.barometerHpa : null,
  };
  const retry = imuSampleSchema.safeParse(fallback);
  return retry.success ? retry.data : null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "bigint") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function parseWatchFix(value: unknown): WatchFix | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const t = asFiniteNumber(record.t);
  if (t == null) {
    return null;
  }
  const activityRaw = record.activity;
  const activity: MotionActivity =
    typeof activityRaw === "string" && MOTION_ACTIVITIES.has(activityRaw as MotionActivity)
      ? (activityRaw as MotionActivity)
      : "unknown";
  return {
    t,
    lat: asFiniteNumber(record.lat),
    lon: asFiniteNumber(record.lon),
    speedMps: asFiniteNumber(record.speedMps),
    accuracyM: asFiniteNumber(record.accuracyM),
    activity,
  };
}

export function parseLocationList(values: unknown): LocationSample[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((item) => parseLocationSample(item))
    .filter((item): item is LocationSample => item != null);
}

export function parseImuList(values: unknown): ImuSample[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((item) => parseImuSample(item))
    .filter((item): item is ImuSample => item != null);
}
