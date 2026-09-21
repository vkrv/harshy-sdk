import { tagCompoundOverlaps } from "./compound.js";
import { mergeDetectorConfig, SCORE_PENALTY_X } from "./config.js";
import { lastLocationAnchor, shouldAcceptDriveFix } from "./drivePath.js";
import {
  clamp,
  derivedCourseDeg,
  derivedSpeedMps,
  haversineM,
  magnitude,
  mpsToKmh,
  severityFromPeak,
  unwrapDeltaDeg,
} from "./geo.js";
import { harshEventLevel, harshLevelRank, liveHarshLevels } from "./harsh.js";
import { advanceHeadingFilter, emptyHeadingFilter, type HeadingFilter } from "./heading.js";
import {
  advanceHandheld,
  closeHandheldSpan,
  emptyHandheldFilter,
  type HandheldFilter,
} from "./handheld.js";
import {
  advanceImpactPulse,
  decideClosedPulse,
  decidePendingImpact,
  type ImpactPulse,
  type PendingImpact,
} from "./impact.js";
import { assessRoad, roadRmsForLocation } from "./road.js";
import {
  MAX_LOCATION_SAMPLES,
  maxImuSamples,
  trimRingBuffer,
} from "./tripBuffer.js";
import type {
  DetectorConfig,
  DeviceInfo,
  DrivingEvent,
  DrivingEventType,
  HarshEventLevel,
  ImpactDirection,
  ImuSample,
  LiveMetrics,
  LocationSample,
  SessionExport,
  TripMetrics,
  TripTrigger,
} from "./types.js";

export type TripAnalyzerOptions = {
  sessionId: string;
  startedAtMs: number;
  device: DeviceInfo;
  /** Override IMU Hz used for the live ring cap (default 50). */
  imuHz?: number;
  /** Why capture began. Default `manual`. Distinct from sensor source. */
  trigger?: TripTrigger;
};

type AnalyzerState = {
  config: DetectorConfig;
  sessionId: string;
  startedAtMs: number;
  trigger: TripTrigger;
  device: DeviceInfo;
  location: LocationSample[];
  imu: ImuSample[];
  events: DrivingEvent[];
  lastEventAt: Partial<Record<DrivingEventType, number>>;
  lastEventLevel: Partial<Record<DrivingEventType, HarshEventLevel>>;
  openSpeeding: DrivingEvent | null;
  openHandheld: DrivingEvent | null;
  handheld: HandheldFilter;
  distanceM: number;
  lastGoodLocation: LocationSample | null;
  locationRejects: number;
  heading: HeadingFilter;
  lastImu: ImuSample | null;
  impactPulse: ImpactPulse | null;
  pendingImpact: PendingImpact | null;
  longitudinalAccelMps2: number | null;
  lateralAccelMps2: number | null;
  yawRateRadps: number | null;
  maxSpeedMps: number | null;
  speedSum: number;
  speedCount: number;
};

function emptyCounts(): Record<DrivingEventType, number> {
  return {
    harsh_accel: 0,
    harsh_brake: 0,
    harsh_corner: 0,
    swerve: 0,
    speeding: 0,
    jerk: 0,
    possible_impact: 0,
    phone_handheld: 0,
  };
}

function locationUsable(sample: LocationSample, config: DetectorConfig): boolean {
  return sample.accuracyM == null || sample.accuracyM <= config.maxLocationAccuracyM;
}

function lastEventOfType(
  events: readonly DrivingEvent[],
  type: DrivingEventType,
): DrivingEvent | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event?.type === type) {
      return event;
    }
  }
  return undefined;
}

function maybeEmit(
  state: AnalyzerState,
  type: DrivingEventType,
  t: number,
  peak: number,
  threshold: number,
  location: LocationSample | null,
  speedMps: number | null,
): DrivingEvent | null {
  const level = harshEventLevel(
    peak,
    threshold,
    state.config.harshMediumX,
    state.config.harshHeavyX,
  );
  const last = state.lastEventAt[type];
  if (last != null && t - last < state.config.cooldownMs) {
    const previous = state.lastEventLevel[type];
    if (previous != null && harshLevelRank(level) <= harshLevelRank(previous)) {
      return null;
    }
    const existing = lastEventOfType(state.events, type);
    if (existing) {
      existing.peak = peak;
      existing.severity = severityFromPeak(peak, threshold);
      existing.level = level;
      existing.lat = location?.lat ?? existing.lat;
      existing.lon = location?.lon ?? existing.lon;
      existing.speedMps = speedMps;
      state.lastEventAt[type] = t;
      state.lastEventLevel[type] = level;
      tagCompoundOverlaps(state.events, existing, t, state.config.compoundWindowMs);
      return existing;
    }
  }

  const event: DrivingEvent = {
    id: `${type}-${t}`,
    type,
    t,
    endT: null,
    peak,
    severity: severityFromPeak(peak, threshold),
    level,
    lat: location?.lat ?? null,
    lon: location?.lon ?? null,
    speedMps,
    overlaps: [],
  };
  state.events.push(event);
  state.lastEventAt[type] = t;
  state.lastEventLevel[type] = level;
  tagCompoundOverlaps(state.events, event, t, state.config.compoundWindowMs);
  return event;
}

/** Match fused GPS fallback cadence (`GPS_STALE_MS` 8 s). */
const GPS_ACCEL_MIN_DT_SEC = 0.2;
const GPS_ACCEL_MAX_DT_SEC = 8;

function gpsWindowAccel(state: AnalyzerState): {
  longitudinal: number | null;
  lateral: number | null;
  yawRateRadps: number | null;
} {
  const { gpsAccelWindowMs } = state.config;
  const current = state.lastGoodLocation;
  if (!current || current.speedMps == null) {
    return { longitudinal: null, lateral: null, yawRateRadps: null };
  }

  let previous: LocationSample | null = null;
  for (let i = state.location.length - 2; i >= 0; i -= 1) {
    const candidate = state.location[i];
    if (!candidate) {
      continue;
    }
    const dt = current.t - candidate.t;
    if (dt >= gpsAccelWindowMs * 0.6 && locationUsable(candidate, state.config)) {
      previous = candidate;
      break;
    }
    if (dt > GPS_ACCEL_MAX_DT_SEC * 1000) {
      break;
    }
  }

  if (!previous || previous.speedMps == null) {
    return { longitudinal: null, lateral: null, yawRateRadps: null };
  }

  const dtSec = (current.t - previous.t) / 1000;
  if (dtSec < GPS_ACCEL_MIN_DT_SEC || dtSec > GPS_ACCEL_MAX_DT_SEC) {
    return { longitudinal: null, lateral: null, yawRateRadps: null };
  }

  const longitudinal = (current.speedMps - previous.speedMps) / dtSec;
  let lateral: number | null = null;
  let yawRateRadps: number | null = null;
  if (current.courseDeg != null && previous.courseDeg != null) {
    const omega = toRadSafe(unwrapDeltaDeg(previous.courseDeg, current.courseDeg)) / dtSec;
    const speed = (current.speedMps + previous.speedMps) / 2;
    lateral = speed * omega;
    // GPS course is junk when the car is stopped; phone gyro is not vehicle heading.
    if (
      previous.speedMps >= state.config.minSpeedMps &&
      current.speedMps >= state.config.minSpeedMps
    ) {
      yawRateRadps = Math.abs(omega);
    }
  }

  return { longitudinal, lateral, yawRateRadps };
}

function toRadSafe(deg: number): number {
  return (deg * Math.PI) / 180;
}

function currentSpeed(state: AnalyzerState): number | null {
  return state.lastGoodLocation?.speedMps ?? null;
}

function closeSpeedingSpan(state: AnalyzerState, t: number): DrivingEvent | null {
  const open = state.openSpeeding;
  if (!open || open.endT != null) {
    return null;
  }
  open.endT = t;
  state.openSpeeding = null;
  tagCompoundOverlaps(state.events, open, t, state.config.compoundWindowMs);
  return open;
}

function updateSpeedingSpan(
  state: AnalyzerState,
  t: number,
  speed: number | null,
  location: LocationSample | null,
  moving: boolean,
): DrivingEvent | null {
  const cap = state.config.speedingMps;
  if (cap == null) {
    return closeSpeedingSpan(state, t);
  }
  const over = moving && speed != null && speed >= cap;
  if (over) {
    const level = harshEventLevel(
      speed,
      cap,
      state.config.harshMediumX,
      state.config.harshHeavyX,
    );
    if (!state.openSpeeding) {
      const event: DrivingEvent = {
        id: `speeding-${t}`,
        type: "speeding",
        t,
        endT: null,
        peak: speed,
        severity: severityFromPeak(speed, cap),
        level,
        lat: location?.lat ?? null,
        lon: location?.lon ?? null,
        speedMps: speed,
        overlaps: [],
      };
      state.events.push(event);
      state.openSpeeding = event;
      tagCompoundOverlaps(state.events, event, t, state.config.compoundWindowMs);
      return event;
    }
    const open = state.openSpeeding;
    if (speed > open.peak) {
      open.peak = speed;
      open.severity = severityFromPeak(speed, cap);
      open.level = level;
      open.lat = location?.lat ?? open.lat;
      open.lon = location?.lon ?? open.lon;
      open.speedMps = speed;
      tagCompoundOverlaps(state.events, open, t, state.config.compoundWindowMs);
      return open;
    }
    return null;
  }
  const exit = cap * state.config.speedingExitX;
  if (state.openSpeeding && (speed == null || speed < exit || !moving)) {
    return closeSpeedingSpan(state, t);
  }
  return null;
}

function detectFromMotion(
  state: AnalyzerState,
  t: number,
): DrivingEvent[] {
  const emitted: DrivingEvent[] = [];
  const speed = currentSpeed(state);
  const moving = speed != null && speed >= state.config.minSpeedMps;
  const location = state.lastGoodLocation;

  const speeding = updateSpeedingSpan(state, t, speed, location, moving);
  if (speeding) {
    emitted.push(speeding);
  }

  if (moving && state.longitudinalAccelMps2 != null) {
    if (state.longitudinalAccelMps2 >= state.config.harshAccelMps2) {
      const event = maybeEmit(
        state,
        "harsh_accel",
        t,
        state.longitudinalAccelMps2,
        state.config.harshAccelMps2,
        location,
        speed,
      );
      if (event) {
        emitted.push(event);
      }
    } else if (state.longitudinalAccelMps2 <= -state.config.harshBrakeMps2) {
      const event = maybeEmit(
        state,
        "harsh_brake",
        t,
        Math.abs(state.longitudinalAccelMps2),
        state.config.harshBrakeMps2,
        location,
        speed,
      );
      if (event) {
        emitted.push(event);
      }
    }
  }

  const cornering =
    moving &&
    state.lateralAccelMps2 != null &&
    Math.abs(state.lateralAccelMps2) >= state.config.harshCornerMps2;
  if (cornering && state.lateralAccelMps2 != null) {
    const event = maybeEmit(
      state,
      "harsh_corner",
      t,
      Math.abs(state.lateralAccelMps2),
      state.config.harshCornerMps2,
      location,
      speed,
    );
    if (event) {
      emitted.push(event);
    }
  }

  const yaw = state.yawRateRadps;
  if (moving && !cornering && yaw != null && yaw >= state.config.harshSwerveRadps) {
    const event = maybeEmit(state, "swerve", t, yaw, state.config.harshSwerveRadps, location, speed);
    if (event) {
      emitted.push(event);
    }
  }

  const gpsWeak =
    location == null ||
    location.accuracyM == null ||
    location.accuracyM > state.config.maxLocationAccuracyM;
  const imuMag = state.lastImu?.linearAccel
    ? magnitude(state.lastImu.linearAccel)
    : state.lastImu
      ? magnitude(state.lastImu.accel)
      : null;
  const jerkSettled = t - state.startedAtMs >= state.config.jerkSettleMs;
  const impactQuiet =
    state.impactPulse == null &&
    state.pendingImpact == null &&
    (state.lastEventAt.possible_impact == null ||
      t - state.lastEventAt.possible_impact >= state.config.impactCooldownMs);
  if (
    jerkSettled &&
    impactQuiet &&
    gpsWeak &&
    imuMag != null &&
    imuMag >= state.config.harshBrakeMps2
  ) {
    const event = maybeEmit(
      state,
      "jerk",
      t,
      imuMag,
      state.config.harshBrakeMps2,
      location,
      speed,
    );
    if (event) {
      emitted.push(event);
    }
  }

  return emitted;
}

function buildMetrics(state: AnalyzerState, t: number): LiveMetrics {
  const durationMs = Math.max(0, t - state.startedAtMs);
  const speedMps = currentSpeed(state);
  const moving = speedMps != null && speedMps >= state.config.minSpeedMps;
  const levels = liveHarshLevels({
    moving,
    longitudinal: state.longitudinalAccelMps2,
    lateral: state.lateralAccelMps2,
    yawRateRadps: state.yawRateRadps,
    config: state.config,
  });
  return {
    t,
    speedMps,
    speedKmh: speedMps == null ? null : mpsToKmh(speedMps),
    headingDeg: state.heading.headingDeg,
    altitudeM: state.lastGoodLocation?.altitudeM ?? null,
    locationAccuracyM: state.lastGoodLocation?.accuracyM ?? null,
    longitudinalAccelMps2: state.longitudinalAccelMps2,
    lateralAccelMps2: state.lateralAccelMps2,
    verticalAccelMps2: state.lastImu?.linearAccel?.z ?? state.lastImu?.accel.z ?? null,
    accelMagnitudeMps2: state.lastImu
      ? magnitude(state.lastImu.linearAccel ?? state.lastImu.accel)
      : null,
    gyroMagnitudeRadps: state.lastImu?.gyro ? magnitude(state.lastImu.gyro) : null,
    accelLevel: levels.accelLevel,
    brakeLevel: levels.brakeLevel,
    cornerLevel: levels.cornerLevel,
    yawRateRadps: state.yawRateRadps,
    swerveLevel: levels.swerveLevel,
    distanceM: state.distanceM,
    durationMs,
    score: scoreEvents(state.events, state.config, {
      distanceM: state.distanceM,
      durationMs,
    }),
  };
}

function eventWeight(type: DrivingEventType, config: DetectorConfig): number {
  switch (type) {
    case "harsh_accel":
      return config.score.harshAccel;
    case "harsh_brake":
      return config.score.harshBrake;
    case "harsh_corner":
      return config.score.harshCorner;
    case "swerve":
      return config.score.swerve;
    case "speeding":
      return config.score.speeding;
    case "jerk":
      return config.score.jerk;
    case "possible_impact":
      return 0;
    case "phone_handheld":
      return 0;
  }
}

function emitPossibleImpact(
  state: AnalyzerState,
  pending: PendingImpact,
  direction: ImpactDirection,
  speedMps: number | null,
): DrivingEvent {
  const event: DrivingEvent = {
    id: `possible_impact-${pending.t}`,
    type: "possible_impact",
    t: pending.t,
    endT: null,
    peak: pending.peak,
    severity: severityFromPeak(pending.peak, state.config.impactPeakMps2),
    level: harshEventLevel(
      pending.peak,
      state.config.impactPeakMps2,
      state.config.harshMediumX,
      state.config.harshHeavyX,
    ),
    lat: pending.lat,
    lon: pending.lon,
    speedMps,
    overlaps: [],
    impactDirection: direction,
  };
  state.events.push(event);
  state.lastEventAt.possible_impact = pending.t;
  state.lastEventLevel.possible_impact = event.level;
  state.pendingImpact = null;
  return event;
}

function resolvePendingImpact(
  state: AnalyzerState,
  now: number,
  force: boolean,
): DrivingEvent | null {
  const pending = state.pendingImpact;
  if (!pending) {
    return null;
  }
  const decision = decidePendingImpact({
    pending,
    location: state.location,
    now,
    force,
    config: state.config,
  });
  if (decision.kind === "wait") {
    return null;
  }
  if (decision.kind === "discard") {
    state.pendingImpact = null;
    return null;
  }
  return emitPossibleImpact(state, pending, decision.direction, decision.speedMps);
}

function acceptClosedImpactPulse(state: AnalyzerState, pulse: ImpactPulse): DrivingEvent | null {
  if (state.pendingImpact) {
    return null;
  }
  const decision = decideClosedPulse({
    pulse,
    imu: state.imu,
    location: state.location,
    lastLat: state.lastGoodLocation?.lat ?? null,
    lastLon: state.lastGoodLocation?.lon ?? null,
    startedAtMs: state.startedAtMs,
    lastImpactAt: state.lastEventAt.possible_impact,
    config: state.config,
  });
  if (decision.kind === "reject") {
    return null;
  }
  state.pendingImpact = decision.pending;
  return resolvePendingImpact(state, pulse.lastAboveT, false);
}

function ingestHandheldImu(state: AnalyzerState, sample: ImuSample): DrivingEvent[] {
  const speed = currentSpeed(state);
  const moving = speed != null && speed >= state.config.minSpeedMps;
  const stepped = advanceHandheld({
    filter: state.handheld,
    open: state.openHandheld,
    lastClosedAt: state.lastEventAt.phone_handheld,
    sample,
    moving,
    speedMps: speed,
    location: state.lastGoodLocation,
    startedAtMs: state.startedAtMs,
    config: state.config,
  });
  state.handheld = stepped.filter;
  state.openHandheld = stepped.open;
  if (stepped.lastClosedAt != null) {
    state.lastEventAt.phone_handheld = stepped.lastClosedAt;
  }
  const emitted = stepped.emitted;
  if (!emitted) {
    return [];
  }
  if (emitted.endT == null && !state.events.includes(emitted)) {
    state.events.push(emitted);
    state.lastEventLevel.phone_handheld = emitted.level;
  } else if (emitted.endT == null) {
    state.lastEventLevel.phone_handheld = emitted.level;
  }
  return [emitted];
}

function flushHandheld(state: AnalyzerState, endedAtMs: number): void {
  const closed = closeHandheldSpan(state.openHandheld, endedAtMs);
  if (closed) {
    state.lastEventAt.phone_handheld = endedAtMs;
  }
  state.openHandheld = null;
}

function ingestImpactImu(state: AnalyzerState, sample: ImuSample): DrivingEvent[] {
  const emitted: DrivingEvent[] = [];
  if (!state.pendingImpact) {
    const stepped = advanceImpactPulse(state.impactPulse, sample, state.config.impactFloorMps2);
    state.impactPulse = stepped.pulse;
    if (stepped.closed) {
      const event = acceptClosedImpactPulse(state, stepped.closed);
      if (event) {
        emitted.push(event);
      }
    }
  }
  const pending = resolvePendingImpact(state, sample.t, false);
  if (pending) {
    emitted.push(pending);
  }
  return emitted;
}

function flushImpact(state: AnalyzerState, endedAtMs: number): void {
  if (state.impactPulse) {
    acceptClosedImpactPulse(state, state.impactPulse);
    state.impactPulse = null;
  }
  resolvePendingImpact(state, endedAtMs, true);
}

export function scoreExposureScale(
  distanceM: number,
  durationMs: number,
  config: DetectorConfig,
): number {
  const km = Math.max(distanceM / 1000, config.score.minDistanceKm);
  const minutes = Math.max(durationMs / 60_000, config.score.minDurationMin);
  const exposure =
    (km / config.score.refDistanceKm + minutes / config.score.refDurationMin) / 2;
  return clamp(1 / Math.max(exposure, 1e-6), 0.2, 4);
}

export function scoreEvents(
  events: readonly DrivingEvent[],
  config: DetectorConfig,
  exposure: { distanceM: number; durationMs: number },
): number {
  let penalty = 0;
  for (const event of events) {
    penalty += eventWeight(event.type, config) * (0.4 + 0.6 * event.severity);
    if (event.overlaps.length > 0) {
      penalty += config.score.compound;
    }
  }
  const scale = scoreExposureScale(exposure.distanceM, exposure.durationMs, config);
  return clamp(config.score.start - penalty * scale * SCORE_PENALTY_X, 0, 100);
}

export function eventCounts(
  events: readonly DrivingEvent[],
): Record<DrivingEventType, number> {
  const counts = emptyCounts();
  for (const event of events) {
    counts[event.type] += 1;
  }
  return counts;
}

export function summarizeTrip(state: {
  startedAtMs: number;
  endedAtMs: number;
  distanceM: number;
  events: DrivingEvent[];
  maxSpeedMps: number | null;
  speedSum: number;
  speedCount: number;
  config: DetectorConfig;
}): TripMetrics {
  return {
    distanceM: state.distanceM,
    durationMs: Math.max(0, state.endedAtMs - state.startedAtMs),
    maxSpeedMps: state.maxSpeedMps,
    avgSpeedMps: state.speedCount === 0 ? null : state.speedSum / state.speedCount,
    score: scoreEvents(state.events, state.config, {
      distanceM: state.distanceM,
      durationMs: Math.max(0, state.endedAtMs - state.startedAtMs),
    }),
    eventCounts: eventCounts(state.events),
  };
}

export type TripAnalyzer = {
  pushLocation: (sample: LocationSample) => {
    metrics: LiveMetrics;
    newEvents: DrivingEvent[];
  };
  pushImu: (sample: ImuSample) => {
    metrics: LiveMetrics;
    newEvents: DrivingEvent[];
  };
  setConfig: (config: DetectorConfig) => void;
  getConfig: () => DetectorConfig;
  getMetrics: () => LiveMetrics;
  getEvents: () => DrivingEvent[];
  finalize: (endedAtMs?: number) => SessionExport;
};

export function createTripAnalyzer(
  configInput: Partial<DetectorConfig> | undefined,
  options: TripAnalyzerOptions,
): TripAnalyzer {
  const maxImu = maxImuSamples(options.imuHz ?? 50);
  const state: AnalyzerState = {
    config: mergeDetectorConfig(configInput),
    sessionId: options.sessionId,
    startedAtMs: options.startedAtMs,
    trigger: options.trigger ?? "manual",
    device: options.device,
    location: [],
    imu: [],
    events: [],
    lastEventAt: {},
    lastEventLevel: {},
    openSpeeding: null,
    openHandheld: null,
    handheld: emptyHandheldFilter(),
    distanceM: 0,
    lastGoodLocation: null,
    locationRejects: 0,
    heading: emptyHeadingFilter(),
    lastImu: null,
    impactPulse: null,
    pendingImpact: null,
    longitudinalAccelMps2: null,
    lateralAccelMps2: null,
    yawRateRadps: null,
    maxSpeedMps: null,
    speedSum: 0,
    speedCount: 0,
  };

  const pushLocation = (sample: LocationSample) => {
    const decision = shouldAcceptDriveFix(
      lastLocationAnchor(state.location),
      sample,
      state.locationRejects,
    );
    state.locationRejects = decision.rejects;
    if (!decision.accept) {
      const t =
        state.lastGoodLocation?.t ?? state.lastImu?.t ?? state.startedAtMs;
      return { metrics: buildMetrics(state, t), newEvents: [] };
    }

    const withRoad: LocationSample = {
      ...sample,
      speedMps: derivedSpeedMps(state.lastGoodLocation, sample) ?? sample.speedMps,
      courseDeg: derivedCourseDeg(state.lastGoodLocation, sample),
      roadRmsMps2:
        sample.roadRmsMps2 ??
        roadRmsForLocation(sample, state.imu, {
          startedAtMs: state.startedAtMs,
          jerkSettleMs: state.config.jerkSettleMs,
          minSpeedMps: state.config.minSpeedMps,
        }),
    };
    state.location.push(withRoad);
    trimRingBuffer(state.location, MAX_LOCATION_SAMPLES);
    if (locationUsable(withRoad, state.config)) {
      if (state.lastGoodLocation) {
        state.distanceM += haversineM(state.lastGoodLocation, withRoad);
      }
      state.lastGoodLocation = withRoad;
      state.heading = advanceHeadingFilter(state.heading, withRoad, state.config.minSpeedMps);
      if (withRoad.speedMps != null) {
        state.speedSum += withRoad.speedMps;
        state.speedCount += 1;
        state.maxSpeedMps =
          state.maxSpeedMps == null
            ? withRoad.speedMps
            : Math.max(state.maxSpeedMps, withRoad.speedMps);
      }
    }

    const accel = gpsWindowAccel(state);
    state.longitudinalAccelMps2 = accel.longitudinal;
    state.lateralAccelMps2 = accel.lateral;
    state.yawRateRadps = accel.yawRateRadps;
    const motion = detectFromMotion(state, withRoad.t);
    const impact = resolvePendingImpact(state, withRoad.t, false);
    const newEvents = impact ? [...motion, impact] : motion;
    return { metrics: buildMetrics(state, withRoad.t), newEvents };
  };

  const pushImu = (sample: ImuSample) => {
    state.imu.push(sample);
    trimRingBuffer(state.imu, maxImu);
    state.lastImu = sample;
    const impact = ingestImpactImu(state, sample);
    const handheld = ingestHandheldImu(state, sample);
    const motion = detectFromMotion(state, sample.t);
    const newEvents = [...impact, ...handheld, ...motion];
    return { metrics: buildMetrics(state, sample.t), newEvents };
  };

  return {
    pushLocation,
    pushImu,
    setConfig: (config) => {
      state.config = mergeDetectorConfig(config);
    },
    getConfig: () => state.config,
    getMetrics: () => buildMetrics(state, state.lastGoodLocation?.t ?? state.lastImu?.t ?? state.startedAtMs),
    getEvents: () => [...state.events],
    finalize: (endedAtMs) => {
      const ended = endedAtMs ?? Date.now();
      flushImpact(state, ended);
      flushHandheld(state, ended);
      closeSpeedingSpan(state, ended);
      return {
        schemaVersion: 1,
        sessionId: state.sessionId,
        startedAt: new Date(state.startedAtMs).toISOString(),
        endedAt: new Date(ended).toISOString(),
        config: state.config,
        location: assessRoad(state.location, state.imu, {
          startedAtMs: state.startedAtMs,
          jerkSettleMs: state.config.jerkSettleMs,
          minSpeedMps: state.config.minSpeedMps,
        }),
        imu: [...state.imu],
        events: [...state.events],
        metrics: summarizeTrip({
          startedAtMs: state.startedAtMs,
          endedAtMs: ended,
          distanceM: state.distanceM,
          events: state.events,
          maxSpeedMps: state.maxSpeedMps,
          speedSum: state.speedSum,
          speedCount: state.speedCount,
          config: state.config,
        }),
        device: state.device,
        trigger: state.trigger,
      };
    },
  };
}

export function analyzeTrip(input: {
  location: LocationSample[];
  imu: ImuSample[];
  config?: Partial<DetectorConfig>;
  sessionId: string;
  startedAtMs: number;
  endedAtMs: number;
  device: DeviceInfo;
  trigger?: TripTrigger;
}): SessionExport {
  const analyzer = createTripAnalyzer(input.config, {
    sessionId: input.sessionId,
    startedAtMs: input.startedAtMs,
    device: input.device,
    trigger: input.trigger,
  });

  const location = [...input.location].sort((a, b) => a.t - b.t);
  const imu = [...input.imu].sort((a, b) => a.t - b.t);
  let li = 0;
  let ii = 0;

  while (li < location.length || ii < imu.length) {
    const loc = location[li];
    const imuSample = imu[ii];
    const takeLocation =
      imuSample == null || (loc != null && loc.t <= imuSample.t);
    if (takeLocation && loc) {
      analyzer.pushLocation(loc);
      li += 1;
    } else if (imuSample) {
      analyzer.pushImu(imuSample);
      ii += 1;
    } else {
      break;
    }
  }

  return analyzer.finalize(input.endedAtMs);
}
