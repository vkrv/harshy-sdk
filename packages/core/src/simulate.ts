import type { ImuSample, LocationSample } from "./types.js";

export type SimulatedTrip = {
  sessionId: string;
  startedAtMs: number;
  endedAtMs: number;
  location: LocationSample[];
  imu: ImuSample[];
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function destPoint(
  lat: number,
  lon: number,
  headingDeg: number,
  distanceM: number,
): { lat: number; lon: number } {
  const earth = 6_371_000;
  const heading = (headingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const ang = distanceM / earth;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(ang) +
      Math.cos(lat1) * Math.sin(ang) * Math.cos(heading),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(heading) * Math.sin(ang) * Math.cos(lat1),
      Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: (lat2 * 180) / Math.PI, lon: (lon2 * 180) / Math.PI };
}

/** Extra world-up linear accel so simulated History can show Road (baseline z is ~0.05). */
function roadBumpMps2(elapsedSec: number): number {
  if (elapsedSec >= 18 && elapsedSec < 19) {
    return 4.2;
  }
  if (elapsedSec >= 40 && elapsedSec < 43) {
    return 1.6 + 0.5 * Math.sin(elapsedSec * 28);
  }
  return 0.05;
}

/**
 * Piecewise motion. Speeds are continuous at segment joins so IMU Δv is not crash-like.
 * Each gentle stretch is 0.6 m/s² for 6 s, inside the smooth band for Standard (ceiling
 * 1.5) and Sensitive (ceiling 1.2), and still inside a 1.2 m/s² retune (ceiling 0.72).
 * Hard stretches stay above the Standard harsh bars.
 */
function motionAt(elapsedSec: number): { speed: number; heading: number } {
  if (elapsedSec <= 6) {
    return { speed: lerp(6, 9.6, elapsedSec / 6), heading: 0 };
  }
  if (elapsedSec <= 16) {
    return { speed: 9.6, heading: 0 };
  }
  if (elapsedSec <= 22) {
    return { speed: 9.6, heading: lerp(0, 21, (elapsedSec - 16) / 6) };
  }
  if (elapsedSec <= 24) {
    return { speed: lerp(9.6, 3.2, (elapsedSec - 22) / 2), heading: 21 };
  }
  if (elapsedSec <= 26) {
    return { speed: 3.2, heading: 21 };
  }
  if (elapsedSec <= 27) {
    return { speed: 3.2, heading: lerp(21, 47, elapsedSec - 26) };
  }
  if (elapsedSec <= 28) {
    return { speed: 3.2, heading: 47 };
  }
  if (elapsedSec <= 30) {
    return { speed: lerp(3.2, 9.2, (elapsedSec - 28) / 2), heading: 47 };
  }
  if (elapsedSec <= 36) {
    return { speed: lerp(9.2, 5.6, (elapsedSec - 30) / 6), heading: 47 };
  }
  if (elapsedSec <= 46) {
    return { speed: 5.6, heading: 47 };
  }
  if (elapsedSec <= 49) {
    return { speed: 5.6, heading: lerp(47, 157, (elapsedSec - 46) / 3) };
  }
  if (elapsedSec <= 50.5) {
    return { speed: lerp(5.6, 0, (elapsedSec - 49) / 1.5), heading: 157 };
  }
  return { speed: 0, heading: 157 };
}

export function generateSampleTrip(options?: {
  startedAtMs?: number;
  durationMs?: number;
  locationHz?: number;
  imuHz?: number;
  startLat?: number;
  startLon?: number;
}): SimulatedTrip {
  const startedAtMs = options?.startedAtMs ?? 1_700_000_000_000;
  const durationMs = options?.durationMs ?? 55_000;
  const locationHz = options?.locationHz ?? 1;
  const imuHz = options?.imuHz ?? 25;
  const startLat = options?.startLat ?? 32.0853;
  const startLon = options?.startLon ?? 34.7818;

  const location: LocationSample[] = [];
  const imu: ImuSample[] = [];
  let lat = startLat;
  let lon = startLon;

  const locationStep = 1000 / locationHz;
  for (let t = 0; t <= durationMs; t += locationStep) {
    const motion = motionAt(t / 1000);
    const dt = t === 0 ? 0 : locationStep / 1000;
    if (dt > 0) {
      const point = destPoint(lat, lon, motion.heading, motion.speed * dt);
      lat = point.lat;
      lon = point.lon;
    }
    location.push({
      t: startedAtMs + t,
      lat,
      lon,
      altitudeM: 18,
      speedMps: motion.speed,
      courseDeg: motion.heading,
      accuracyM: 5,
      altitudeAccuracyM: 3,
    });
  }

  const imuStep = 1000 / imuHz;
  for (let t = 0; t <= durationMs; t += imuStep) {
    const motion = motionAt(t / 1000);
    const next = motionAt((t + imuStep) / 1000);
    const dt = imuStep / 1000;
    const longAccel = (next.speed - motion.speed) / dt;
    const headingDelta =
      ((((next.heading - motion.heading + 180) % 360) + 360) % 360) - 180;
    const latAccel = motion.speed * ((headingDelta * Math.PI) / 180 / dt);
    imu.push({
      t: startedAtMs + t,
      accel: { x: latAccel, y: longAccel + 0.2, z: 9.81 },
      linearAccel: { x: latAccel, y: longAccel, z: roadBumpMps2(t / 1000) },
      gyro: { x: 0, y: 0, z: (headingDelta * Math.PI) / 180 / dt },
      magnetometer: { x: 20, y: 5, z: -40 },
      attitude: {
        pitch: 0.02,
        roll: 0.01,
        yaw: (motion.heading * Math.PI) / 180,
      },
      gravity: { x: 0, y: 0, z: 9.81 },
      barometerHpa: 1013.2,
    });
  }

  return {
    sessionId: "sim-sample",
    startedAtMs,
    endedAtMs: startedAtMs + durationMs,
    location,
    imu,
  };
}

export type PlaybackHandlers = {
  onLocation: (sample: LocationSample) => void;
  onImu: (sample: ImuSample) => void;
  onDone: () => void;
};

export function playSimulatedTrip(
  trip: SimulatedTrip,
  handlers: PlaybackHandlers,
  options?: { speed?: number; now?: () => number; schedule?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout> },
): () => void {
  const speed = options?.speed ?? 1;
  const now = options?.now ?? Date.now;
  const schedule = options?.schedule ?? setTimeout;
  const startedWall = now();
  const origin = trip.startedAtMs;
  const frames: Array<{ t: number; kind: "location" | "imu"; index: number }> = [];

  trip.location.forEach((sample, index) => {
    frames.push({ t: sample.t, kind: "location", index });
  });
  trip.imu.forEach((sample, index) => {
    frames.push({ t: sample.t, kind: "imu", index });
  });
  frames.sort((a, b) => a.t - b.t);

  let cancelled = false;
  let cursor = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = () => {
    if (cancelled) {
      return;
    }
    const elapsed = (now() - startedWall) * speed;
    while (cursor < frames.length) {
      const frame = frames[cursor];
      if (!frame) {
        break;
      }
      const due = frame.t - origin;
      if (due > elapsed) {
        const wait = Math.max(4, (due - elapsed) / speed);
        timer = schedule(tick, wait);
        return;
      }
      if (frame.kind === "location") {
        const sample = trip.location[frame.index];
        if (sample) {
          handlers.onLocation(sample);
        }
      } else {
        const sample = trip.imu[frame.index];
        if (sample) {
          handlers.onImu(sample);
        }
      }
      cursor += 1;
    }
    handlers.onDone();
  };

  timer = schedule(tick, 0);
  return () => {
    cancelled = true;
    if (timer) {
      clearTimeout(timer);
    }
  };
}

export function progress01(elapsedMs: number, durationMs: number): number {
  return clamp01(durationMs === 0 ? 1 : elapsedMs / durationMs);
}
