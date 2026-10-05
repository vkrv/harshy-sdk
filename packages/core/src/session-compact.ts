import type { LocationSample, SessionExport } from "./types.js";

/** Compact GPS sample for local archives: keep speed, accuracy, and road RMS. */
export function compactLocationSample(sample: LocationSample): LocationSample {
  return {
    t: sample.t,
    lat: sample.lat,
    lon: sample.lon,
    altitudeM: null,
    speedMps: sample.speedMps,
    courseDeg: null,
    accuracyM: sample.accuracyM ?? null,
    altitudeAccuracyM: null,
    roadRmsMps2: sample.roadRmsMps2 ?? null,
  };
}

/** Archive-friendly session: coordinates + speed + road RMS, no IMU. */
export function compactSessionExport(session: SessionExport): SessionExport {
  return {
    ...session,
    location: session.location.map(compactLocationSample),
    imu: [],
  };
}

/** Keys written only when set. Missing keys parse back as null. */
const OMIT_WHEN_NULL = new Set([
  "altitudeM",
  "altitudeAccuracyM",
  "courseDeg",
  "roadRmsMps2",
  "endT",
  "speedingMps",
]);

/** Compact session JSON without null placeholders for fields the archive does not keep. */
export function stringifySessionExport(value: unknown): string {
  return JSON.stringify(value, (key, nested) => {
    if (nested === null && OMIT_WHEN_NULL.has(key)) {
      return undefined;
    }
    return nested;
  });
}
