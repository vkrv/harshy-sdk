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
 * Which canned drive to play. `sample` is the original north-then-hook script
 * (tests). Live playback cycles `loop`, `slalom`, and `return` so two starts
 * are never the same shape.
 */
export const SIM_TRIP_VARIANTS = ["sample", "loop", "slalom", "return"] as const;

/** Drives the simulator actually plays. `sample` stays the fixed test fixture. */
export const LIVE_SIM_VARIANTS = ["loop", "slalom", "return"] as const;

export type SimTripVariant = (typeof SIM_TRIP_VARIANTS)[number];

type MotionKnot = { t: number; speed: number; heading: number };

/**
 * Speeds meet at each knot so IMU Δv is not crash-like.
 * Gentle stretches stay near 0.6 m/s². Hard stretches clear the Standard bars
 * and stay well under a 20 m/s² retune. Swerves are a ~1 s heading step at
 * ~6 m/s so yaw clears the swerve bar without also counting as a harsh corner.
 */
const TRIP_KNOTS: Record<Exclude<SimTripVariant, "sample">, readonly MotionKnot[]> = {
  /** Constant-rate full turn: the track closes on itself. */
  loop: [
    { t: 0, speed: 8, heading: 0 },
    { t: 40, speed: 8, heading: 360 },
    { t: 42, speed: 1.4, heading: 360 },
    { t: 50, speed: 0, heading: 360 },
  ],
  /** Heading swings left and right, so the track is a snake, then one lane flick. */
  slalom: [
    { t: 0, speed: 4, heading: 0 },
    { t: 2, speed: 10.2, heading: 0 },
    { t: 4, speed: 7, heading: 0 },
    { t: 9, speed: 7, heading: 50 },
    { t: 14, speed: 7, heading: -20 },
    { t: 19, speed: 7, heading: 55 },
    { t: 24, speed: 7, heading: -25 },
    { t: 29, speed: 7, heading: 40 },
    { t: 34, speed: 7, heading: 0 },
    { t: 38, speed: 5.5, heading: 0 },
    { t: 39, speed: 5.5, heading: 26 },
    { t: 48, speed: 0, heading: 26 },
  ],
  /** Straight out, a U-turn, and back over the same road. */
  return: [
    { t: 0, speed: 8, heading: 90 },
    { t: 18, speed: 8, heading: 90 },
    { t: 22, speed: 7, heading: 270 },
    { t: 40, speed: 7, heading: 270 },
    { t: 48, speed: 0, heading: 270 },
  ],
};

function motionFromKnots(knots: readonly MotionKnot[], elapsedSec: number): { speed: number; heading: number } {
  const first = knots[0];
  if (!first || elapsedSec <= first.t) {
    return { speed: first?.speed ?? 0, heading: first?.heading ?? 0 };
  }
  for (let i = 1; i < knots.length; i += 1) {
    const prev = knots[i - 1];
    const next = knots[i];
    if (!prev || !next || elapsedSec > next.t) {
      continue;
    }
    const span = next.t - prev.t;
    const u = span === 0 ? 1 : (elapsedSec - prev.t) / span;
    return {
      speed: lerp(prev.speed, next.speed, u),
      heading: lerp(prev.heading, next.heading, u),
    };
  }
  const last = knots[knots.length - 1];
  return { speed: last?.speed ?? 0, heading: last?.heading ?? 0 };
}

function scriptDurationMs(variant: SimTripVariant): number {
  if (variant === "sample") {
    return 55_000;
  }
  const last = TRIP_KNOTS[variant][TRIP_KNOTS[variant].length - 1];
  return (last?.t ?? 55) * 1000;
}

function roadForVariant(variant: SimTripVariant, elapsedSec: number): number {
  if (variant === "sample") {
    return roadBumpMps2(elapsedSec);
  }
  if (variant === "loop") {
    if (elapsedSec >= 12 && elapsedSec < 13) {
      return 3.6;
    }
    return 0.05;
  }
  if (variant === "slalom") {
    if (elapsedSec >= 16 && elapsedSec < 18) {
      return 1.5 + 0.4 * Math.sin(elapsedSec * 22);
    }
    return 0.05;
  }
  if (elapsedSec >= 8 && elapsedSec < 9) {
    return 4;
  }
  return 0.05;
}

function wrapHeading(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * Piecewise motion for the original sample. Speeds are continuous at segment joins
 * so IMU Δv is not crash-like. Each gentle stretch is 0.6 m/s² for 6 s, inside the
 * smooth band for Standard (ceiling 1.5) and Sensitive (ceiling 1.2), and still
 * inside a 1.2 m/s² retune (ceiling 0.72). Hard stretches stay above the Standard harsh bars.
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

function motionFor(variant: SimTripVariant, elapsedSec: number): { speed: number; heading: number } {
  if (variant === "sample") {
    return motionAt(elapsedSec);
  }
  return motionFromKnots(TRIP_KNOTS[variant], elapsedSec);
}

export function generateSampleTrip(options?: {
  startedAtMs?: number;
  durationMs?: number;
  locationHz?: number;
  imuHz?: number;
  startLat?: number;
  startLon?: number;
  /** Canned drive. Omitted plays the original sample. */
  variant?: SimTripVariant;
  /** Rotates the whole route so the same script does not always point north. */
  headingOffsetDeg?: number;
}): SimulatedTrip {
  const startedAtMs = options?.startedAtMs ?? 1_700_000_000_000;
  const variant = options?.variant ?? "sample";
  const durationMs = options?.durationMs ?? scriptDurationMs(variant);
  const locationHz = options?.locationHz ?? 1;
  const imuHz = options?.imuHz ?? 25;
  const startLat = options?.startLat ?? 32.0853;
  const startLon = options?.startLon ?? 34.7818;
  const headingOffsetDeg = options?.headingOffsetDeg ?? 0;

  const location: LocationSample[] = [];
  const imu: ImuSample[] = [];
  let lat = startLat;
  let lon = startLon;

  const posed = (elapsedSec: number) => {
    const motion = motionFor(variant, elapsedSec);
    return {
      speed: motion.speed,
      heading: wrapHeading(motion.heading + headingOffsetDeg),
    };
  };

  const locationStep = 1000 / locationHz;
  for (let t = 0; t <= durationMs; t += locationStep) {
    const motion = posed(t / 1000);
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
    const motion = posed(t / 1000);
    const next = posed((t + imuStep) / 1000);
    const dt = imuStep / 1000;
    const longAccel = (next.speed - motion.speed) / dt;
    const headingDelta =
      ((((next.heading - motion.heading + 180) % 360) + 360) % 360) - 180;
    const latAccel = motion.speed * ((headingDelta * Math.PI) / 180 / dt);
    imu.push({
      t: startedAtMs + t,
      accel: { x: latAccel, y: longAccel + 0.2, z: 9.81 },
      linearAccel: { x: latAccel, y: longAccel, z: roadForVariant(variant, t / 1000) },
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
