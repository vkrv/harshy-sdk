/** Max GPS samples retained in live RAM / journal (~2.8 h @ 500 ms). */
export const MAX_LOCATION_SAMPLES = 20_000;

/** IMU retention window in minutes (matches native `imuHz * 60 * 120`). */
export const MAX_IMU_MINUTES = 120;

/** How long speed must stay below `minSpeedMps` before idle thinning engages. */
export const IDLE_HYSTERESIS_MS = 2500;

/** Sparse GPS interval while idle (breadcrumbs only). */
export const IDLE_LOCATION_INTERVAL_MS = 8_000;

/** Minimum horizontal move (m) to keep an idle GPS fix even before the interval. */
export const IDLE_LOCATION_MIN_MOVE_M = 15;

export function maxImuSamples(imuHz: number): number {
  const hz = Number.isFinite(imuHz) && imuHz > 0 ? Math.floor(imuHz) : 50;
  return hz * 60 * MAX_IMU_MINUTES;
}

export type IdleMotionState = {
  /** Last GPS speed used for the gate (m/s); null until a usable fix. */
  lastSpeedMps: number | null;
  /** When speed last dropped below the gate (ms), or null while moving / unknown. */
  belowSinceMs: number | null;
  /** Last GPS sample time that was kept while idle. */
  lastIdleLocationAtMs: number | null;
  lastIdleLat: number | null;
  lastIdleLon: number | null;
};

export function emptyIdleMotionState(): IdleMotionState {
  return {
    lastSpeedMps: null,
    belowSinceMs: null,
    lastIdleLocationAtMs: null,
    lastIdleLat: null,
    lastIdleLon: null,
  };
}

function haversineM(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Update idle gate from a GPS fix. Returns whether the vehicle is currently
 * considered idle for journal / ring thinning (hysteresis applied).
 */
export function advanceIdleMotion(
  state: IdleMotionState,
  sample: { t: number; speedMps?: number | null; lat?: number; lon?: number },
  minSpeedMps: number,
  hysteresisMs = IDLE_HYSTERESIS_MS,
): { state: IdleMotionState; idle: boolean } {
  const speed = sample.speedMps;
  const next: IdleMotionState = { ...state };

  if (speed == null || !Number.isFinite(speed)) {
    return { state: next, idle: isIdle(next, sample.t, hysteresisMs) };
  }

  next.lastSpeedMps = speed;
  if (speed >= minSpeedMps) {
    next.belowSinceMs = null;
  } else if (next.belowSinceMs == null) {
    next.belowSinceMs = sample.t;
  }

  return { state: next, idle: isIdle(next, sample.t, hysteresisMs) };
}

export function isIdle(
  state: IdleMotionState,
  nowMs: number,
  hysteresisMs = IDLE_HYSTERESIS_MS,
): boolean {
  if (state.belowSinceMs == null) {
    return false;
  }
  return nowMs - state.belowSinceMs >= hysteresisMs;
}

/**
 * Whether to keep a GPS sample while idle. Moving samples are always kept
 * (caller should only call this when idle).
 */
export function shouldKeepIdleLocation(
  state: IdleMotionState,
  sample: { t: number; lat: number; lon: number },
  intervalMs = IDLE_LOCATION_INTERVAL_MS,
  minMoveM = IDLE_LOCATION_MIN_MOVE_M,
): { keep: boolean; state: IdleMotionState } {
  const lastAt = state.lastIdleLocationAtMs;
  const moved =
    state.lastIdleLat != null &&
    state.lastIdleLon != null &&
    haversineM(state.lastIdleLat, state.lastIdleLon, sample.lat, sample.lon) >=
      minMoveM;
  const due = lastAt == null || sample.t - lastAt >= intervalMs;
  if (!due && !moved) {
    return { keep: false, state };
  }
  return {
    keep: true,
    state: {
      ...state,
      lastIdleLocationAtMs: sample.t,
      lastIdleLat: sample.lat,
      lastIdleLon: sample.lon,
    },
  };
}

/**
 * Fraction of `max` dropped as headroom when the ring overflows.
 * Avoids `splice(0, 1)` on every sample after a multi-hour cap (O(n) thrash → OOM).
 */
export const RING_TRIM_SLACK_FRACTION = 0.02;

/** Drop oldest entries so `items.length <= max`. Mutates in place. */
export function trimRingBuffer<T>(items: T[], max: number): void {
  if (max <= 0) {
    items.length = 0;
    return;
  }
  if (items.length <= max) {
    return;
  }
  // Chunk-drop below `max` so the next overflow is amortized, not per-sample.
  const slack =
    max < 50 ? 0 : Math.max(1, Math.floor(max * RING_TRIM_SLACK_FRACTION));
  const target = Math.max(0, max - slack);
  items.splice(0, items.length - target);
}
