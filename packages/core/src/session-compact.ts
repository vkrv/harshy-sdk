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
