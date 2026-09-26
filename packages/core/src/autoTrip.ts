import { derivedSpeedMps, haversineM } from "./geo.js";
import type { TripTrigger } from "./types.js";

/** Coarse OS motion / Activity Recognition hint. Not F-mode (car vs walk/bike). */
export type MotionActivity =
  | "automotive"
  | "cycling"
  | "walking"
  | "running"
  | "stationary"
  | "unknown";

/**
 * Sparse watch sample. Not a trip journal GPS/IMU row — no IMU, duty-cycled.
 * Native MotionWatch feeds these; unit tests synthesize them.
 */
export type WatchFix = {
  t: number;
  lat: number | null;
  lon: number | null;
  speedMps: number | null;
  accuracyM: number | null;
  activity: MotionActivity;
};

/**
 * v1 start/stop tunables. Marked clearly so Signumb / hosts can retune later
 * without forking the heuristic. Not part of `DetectorConfig`.
 */
export type TripHeuristicConfig = {
  /** Speed that counts as driving (10 km/h). A typical walk stays below this. */
  startSpeedMps: number;
  /** Horizontal distance while continuously above `startSpeedMps` to begin warmup. */
  startDistanceM: number;
  /** Time speed must stay above `startSpeedMps` to begin warmup. */
  startHoldMs: number;
  /**
   * After warmup `start()`, distance while still at vehicle speed that commits
   * the recording (failed warmup is discarded).
   */
  commitDistanceM: number;
  /** After warmup `start()`, time at vehicle speed that commits the recording. */
  commitHoldMs: number;
  /** Speed at or below this counts as dwell / stopped. */
  endSpeedMps: number;
  /**
   * How long to stay below `endSpeedMps` (and inside `endRadiusM`) before ending
   * a **committed** auto trip. Auto-stop then cuts this parked dwell off the
   * saved trip (`slowSinceMs`).
   */
  endHoldMs: number;
  /**
   * Park timeout while still in warmup. Shorter than `endHoldMs` so a false
   * start does not sit on FGS for 10 min.
   */
  warmupEndHoldMs: number;
  /**
   * If the phone moves farther than this while “slow”, treat as traffic crawl,
   * not parked — reset the dwell timer.
   */
  endRadiusM: number;
  /** Ignore watch fixes noisier than this. */
  maxAccuracyM: number;
  /**
   * Soft F-mode: when true, **cycling** blocks a start even at vehicle speed.
   * Walking / running do not block when kinematics are already at `startSpeedMps`
   * (pocket steps / in-car vibration). Slow walk/run still reset. Unknown
   * activity uses kinematics. Automotive does not skip the speed/distance gates.
   */
  rejectNonAutomotive: boolean;
};

export const DEFAULT_TRIP_HEURISTIC_CONFIG: TripHeuristicConfig = {
  startSpeedMps: 10 / 3.6,
  startDistanceM: 40,
  startHoldMs: 5_000,
  commitDistanceM: 150,
  commitHoldMs: 20_000,
  endSpeedMps: 2.5,
  endHoldMs: 600_000,
  warmupEndHoldMs: 30_000,
  endRadiusM: 80,
  maxAccuracyM: 50,
  rejectNonAutomotive: true,
};

export type TripStartState = {
  movingSinceMs: number | null;
  distanceM: number;
  lastLat: number | null;
  lastLon: number | null;
  lastT: number | null;
};

export type TripEndState = {
  /** First slow fix of the current dwell — auto-stop trims samples after this. */
  slowSinceMs: number | null;
  anchorLat: number | null;
  anchorLon: number | null;
  lastLat: number | null;
  lastLon: number | null;
  lastT: number | null;
};

const NON_AUTOMOTIVE: ReadonlySet<MotionActivity> = new Set([
  "cycling",
  "walking",
  "running",
]);

export function mergeTripHeuristicConfig(
  overrides?: Partial<TripHeuristicConfig>,
): TripHeuristicConfig {
  return { ...DEFAULT_TRIP_HEURISTIC_CONFIG, ...overrides };
}

/** Feed `shouldStartTrip` the commit (warmup → recording) gates. */
export function commitStartConfig(
  configInput?: Partial<TripHeuristicConfig>,
): TripHeuristicConfig {
  const config = mergeTripHeuristicConfig(configInput);
  return { ...config, startHoldMs: config.commitHoldMs, startDistanceM: config.commitDistanceM };
}

/** Feed `shouldEndTrip` the warmup abort park timeout. */
export function warmupEndConfig(
  configInput?: Partial<TripHeuristicConfig>,
): TripHeuristicConfig {
  const config = mergeTripHeuristicConfig(configInput);
  return { ...config, endHoldMs: config.warmupEndHoldMs };
}

export function emptyTripStartState(): TripStartState {
  return {
    movingSinceMs: null,
    distanceM: 0,
    lastLat: null,
    lastLon: null,
    lastT: null,
  };
}

export function emptyTripEndState(): TripEndState {
  return {
    slowSinceMs: null,
    anchorLat: null,
    anchorLon: null,
    lastLat: null,
    lastLon: null,
    lastT: null,
  };
}

export function isNonAutomotiveActivity(activity: MotionActivity): boolean {
  return NON_AUTOMOTIVE.has(activity);
}

export function locationToWatchFix(
  sample: {
    t: number;
    lat: number;
    lon: number;
    speedMps?: number | null;
    accuracyM?: number | null;
  },
  activity: MotionActivity = "unknown",
): WatchFix {
  return {
    t: sample.t,
    lat: sample.lat,
    lon: sample.lon,
    speedMps: sample.speedMps ?? null,
    accuracyM: sample.accuracyM ?? null,
    activity,
  };
}

function usableFix(fix: WatchFix, maxAccuracyM: number): boolean {
  if (fix.lat == null || fix.lon == null) {
    return false;
  }
  if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lon)) {
    return false;
  }
  if (fix.accuracyM != null && Number.isFinite(fix.accuracyM) && fix.accuracyM > maxAccuracyM) {
    return false;
  }
  return true;
}

function resetStart(): TripStartState {
  return emptyTripStartState();
}

/**
 * Start kinematics. GNSS often reports 0 before the speed field is valid —
 * if displacement shows motion, prefer that. Analyzer live speed still uses
 * reported 0 so rest heading / idle / handheld stay still.
 */
const NEGLIGIBLE_TRIP_SPEED_MPS = 0.5;

function tripKinematicSpeedMps(
  from: { t: number; lat: number; lon: number } | null,
  to: { t: number; lat: number; lon: number; speedMps: number | null },
): number | null {
  const reported = to.speedMps;
  const hasReported = reported != null && Number.isFinite(reported) && reported >= 0;
  const inferred = derivedSpeedMps(from, {
    t: to.t,
    lat: to.lat,
    lon: to.lon,
    speedMps: hasReported && reported >= NEGLIGIBLE_TRIP_SPEED_MPS ? reported : null,
  });
  if (hasReported && reported >= NEGLIGIBLE_TRIP_SPEED_MPS) {
    return reported;
  }
  if (inferred != null) {
    return inferred;
  }
  if (hasReported) {
    return reported;
  }
  return null;
}

/** Auto-end: a reported 0 is parked (radius handles GPS-0 while still rolling). */
function tripEndSpeedMps(
  from: { t: number; lat: number; lon: number } | null,
  to: { t: number; lat: number; lon: number; speedMps: number | null },
): number | null {
  const reported = to.speedMps;
  if (reported != null && Number.isFinite(reported) && reported >= 0) {
    return reported;
  }
  return derivedSpeedMps(from, { t: to.t, lat: to.lat, lon: to.lon, speedMps: reported });
}

/**
 * Whether an armed watch should call existing `start({ trigger: "auto" })`.
 * Does not start sensors itself.
 */
export function shouldStartTrip(
  state: TripStartState,
  fix: WatchFix,
  configInput?: Partial<TripHeuristicConfig>,
): { start: boolean; state: TripStartState } {
  const config = mergeTripHeuristicConfig(configInput);
  if (!usableFix(fix, config.maxAccuracyM)) {
    return { start: false, state };
  }

  const lat = fix.lat as number;
  const lon = fix.lon as number;
  const from =
    state.lastLat != null && state.lastLon != null && state.lastT != null
      ? { t: state.lastT, lat: state.lastLat, lon: state.lastLon }
      : null;
  const speed = tripKinematicSpeedMps(from, { t: fix.t, lat, lon, speedMps: fix.speedMps });
  const pin = (base: TripStartState): TripStartState => ({
    ...base,
    lastLat: lat,
    lastLon: lon,
    lastT: fix.t,
  });

  if (config.rejectNonAutomotive && isNonAutomotiveActivity(fix.activity)) {
    const walkingLike = fix.activity === "walking" || fix.activity === "running";
    const vehicleKinematics = speed != null && speed >= config.startSpeedMps;
    // Step-detector / pocket vibration often labels a car as walking.
    // Kinematics win for walk/run; cycling still blocks at vehicle speed.
    if (!(walkingLike && vehicleKinematics)) {
      return { start: false, state: pin(resetStart()) };
    }
  }

  if (speed == null || !Number.isFinite(speed)) {
    // A long gap cannot keep hold/distance — significant-location dt is often >60 s.
    return { start: false, state: pin(from != null ? resetStart() : state) };
  }
  if (speed < config.startSpeedMps) {
    return { start: false, state: pin(resetStart()) };
  }

  let next: TripStartState = {
    movingSinceMs: state.movingSinceMs ?? fix.t,
    distanceM: state.distanceM,
    lastLat: state.lastLat,
    lastLon: state.lastLon,
    lastT: state.lastT,
  };
  if (next.lastLat != null && next.lastLon != null) {
    next = {
      ...next,
      distanceM: next.distanceM + haversineM({ lat: next.lastLat, lon: next.lastLon }, { lat, lon }),
    };
  }
  next = pin(next);

  const held = fix.t - (next.movingSinceMs ?? fix.t) >= config.startHoldMs;
  const farEnough = next.distanceM >= config.startDistanceM;
  return { start: held && farEnough, state: next };
}

/**
 * Whether an auto-started trip should call existing `stop()`.
 * Manual trips must not use this. During a trip, feed GPS samples
 * (activity typically `unknown` unless the OS stamps one).
 */
export function shouldEndTrip(
  state: TripEndState,
  fix: WatchFix,
  configInput?: Partial<TripHeuristicConfig>,
): { end: boolean; state: TripEndState } {
  const config = mergeTripHeuristicConfig(configInput);
  if (!usableFix(fix, config.maxAccuracyM)) {
    return { end: false, state };
  }

  const lat = fix.lat as number;
  const lon = fix.lon as number;
  const from =
    state.lastLat != null && state.lastLon != null && state.lastT != null
      ? { t: state.lastT, lat: state.lastLat, lon: state.lastLon }
      : null;
  let speed = tripEndSpeedMps(from, { t: fix.t, lat, lon, speedMps: fix.speedMps });
  /**
   * `derivedSpeedMps` caps at 60 s, so a multi-minute GPS blackout yields null
   * speed and used to only pin the clock — the park timer never advanced.
   * Over a silence ≥ endHoldMs, use path average speed to decide parked vs still driving.
   */
  if (
    (speed == null || !Number.isFinite(speed)) &&
    from != null &&
    fix.t - from.t >= config.endHoldMs
  ) {
    const dtSec = (fix.t - from.t) / 1000;
    if (dtSec > 0 && Number.isFinite(dtSec)) {
      const pathSpeed = haversineM(from, { lat, lon }) / dtSec;
      if (Number.isFinite(pathSpeed)) {
        speed = pathSpeed;
      }
    }
  }
  const pin = (base: TripEndState): TripEndState => ({
    ...base,
    lastLat: lat,
    lastLon: lon,
    lastT: fix.t,
  });

  if (speed == null || !Number.isFinite(speed)) {
    // Short gap / no kinematics: do not start a park timer, and do not clear one.
    return { end: false, state: pin(state) };
  }

  const moving = speed >= config.endSpeedMps;
  if (moving) {
    return { end: false, state: pin(emptyTripEndState()) };
  }

  /**
   * GPS silent for the whole park (Doze / FGS gap / process death): sample-time
   * dwell never advanced. Resume already slow after ≥ endHoldMs → end and trim
   * after the last pre-gap sample so the dead journal hole is not trip duration.
   */
  if (
    state.lastT != null &&
    fix.t - state.lastT >= config.endHoldMs &&
    state.slowSinceMs == null
  ) {
    return {
      end: true,
      state: pin({
        slowSinceMs: state.lastT,
        anchorLat: state.lastLat,
        anchorLon: state.lastLon,
        lastLat: state.lastLat,
        lastLon: state.lastLon,
        lastT: state.lastT,
      }),
    };
  }

  let next: TripEndState = state.slowSinceMs == null
    ? { ...emptyTripEndState(), slowSinceMs: fix.t, anchorLat: lat, anchorLon: lon }
    : { ...state };

  if (next.anchorLat != null && next.anchorLon != null) {
    const moved = haversineM(
      { lat: next.anchorLat, lon: next.anchorLon },
      { lat, lon },
    );
    if (moved > config.endRadiusM) {
      next = { ...emptyTripEndState(), slowSinceMs: fix.t, anchorLat: lat, anchorLon: lon };
    }
  }

  const dwell = next.slowSinceMs != null && fix.t - next.slowSinceMs >= config.endHoldMs;
  return { end: dwell, state: pin(next) };
}

/**
 * Drop GPS/IMU recorded during the parked dwell that triggered auto-stop.
 * Keeps the sample at `idleStartedAtMs` (the moment speed fell) so the trip
 * ends when the vehicle stopped, not after the dwell that triggered stop.
 */
export function trimIdleTailSamples<T extends { t: number }>(
  samples: readonly T[],
  idleStartedAtMs: number,
): T[] {
  return samples.filter((sample) => sample.t <= idleStartedAtMs);
}

/** Wall-clock `endedAt` for a trip whose parked dwell was cut at `idleStartedAtMs`. */
export function endedAtMsWithoutIdleTail(
  startedAtMs: number,
  idleStartedAtMs: number,
  fallbackEndedAtMs: number,
): number {
  return Math.max(startedAtMs, Math.min(idleStartedAtMs, fallbackEndedAtMs));
}

/** `"auto"` stays auto; anything else (including missing journal/JSON) is `manual`. */
export function parseTripTrigger(value: unknown): TripTrigger {
  return value === "auto" ? "auto" : "manual";
}
