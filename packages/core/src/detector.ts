import {
  IMU_BRAKE_AXIS_TILT_DEG,
  IMU_BRAKE_GAP_MS,
  IMU_BRAKE_HOLD_MS,
  IMU_BRAKE_LEARN_MIN_MPS,
  IMU_BRAKE_RECENT_MS,
  blendForwardAxis,
  brakeAlongForward,
  forwardSampleFromGps,
  gpsHarshBrakeQualifies,
  horizontalLinear,
  type GpsBrakeSample,
} from "./brake.js";
import { tagCompoundOverlaps } from "./compound.js";
import {
  mergeDetectorConfig,
  HARSH_CORNER_HOLD_MIN_M,
  HARSH_CORNER_HOLD_MS,
  HARSH_CORNER_MIN_TURN_DEG,
  PATH_ONLY_CORNER_MAX_ACCURACY_M,
  PATH_ONLY_LATERAL_MAX_MPS2,
  SCORE_EXPOSURE_MAX,
  SCORE_EXPOSURE_MIN,
  SCORE_MAX,
  SMOOTH_CEILING_X,
  SMOOTH_CORNER_MIN_TURN_DEG,
  SMOOTH_CREEP_FLOOR_MPS2,
  SMOOTH_CREEP_HOLD_MIN_M,
  SMOOTH_CREEP_HOLD_MS,
  SMOOTH_CREEP_MIN_SPEED_DELTA_MPS,
  SMOOTH_FLOOR_MPS2,
  SMOOTH_GAP_M,
  SMOOTH_HOLD_MIN_M,
  SMOOTH_HOLD_MS,
  relativeScore,
} from "./config.js";
import { HARSHY_SDK_VERSION } from "./version.js";
import {
  isSuspiciousSpeedLeap,
  lastLocationAnchor,
  shouldAcceptDriveFix,
  speedLeapHolds,
} from "./drivePath.js";
import {
  clamp,
  confirmedYawDetail,
  DERIVED_COURSE_MIN_M,
  derivedCourseDeg,
  derivedSpeedMps,
  haversineM,
  magnitude,
  mpsToKmh,
  pathBearingDeg,
  severityFromPeak,
  unwrapDeltaDeg,
  verticalGyroRadps,
} from "./geo.js";
import {
  harshEventLevel,
  harshLevelRank,
  isSwerveMotion,
  liveHarshLevels,
  yawRateJerkRadps2,
} from "./harsh.js";
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
  gravityTiltDeg,
  sampleLinearAccel,
  verticalShare,
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
  NativeStartOptions,
  Vec3,
} from "./types.js";

export type TripAnalyzerOptions = {
  sessionId: string;
  startedAtMs: number;
  device: DeviceInfo;
  /** Override IMU Hz used for the live ring cap (default 50). */
  imuHz?: number;
  /**
   * Override the IMU ring size. Detection only looks back seconds, so hosts that do not export raw
   * IMU can keep a short window. Default: `maxImuSamples(imuHz)` (MAX_IMU_MINUTES of samples).
   */
  maxImuSamples?: number;
  /** Why capture began. Default `manual`. Distinct from sensor source. */
  trigger?: TripTrigger;
  /** Original native capture options used to start the trip. */
  capture?: NativeStartOptions;
};

const SMOOTH_TYPES = ["smooth_accel", "smooth_brake", "smooth_corner"] as const;

export type SmoothDrivingEventType = (typeof SMOOTH_TYPES)[number];

type SmoothHold = {
  sinceT: number;
  sinceDistanceM: number;
  peak: number;
  /** Lateral sign for `smooth_corner` (+1 / −1). Accel/brake omit. */
  sign?: number;
  /** Speed when an accel/brake hold began. Creep credits need a real change. */
  speedAtStartMps?: number;
  /** Track heading when a corner hold began. */
  headingAtStartDeg?: number;
};

export function isSmoothDrivingEvent(
  type: DrivingEventType,
): type is SmoothDrivingEventType {
  return (SMOOTH_TYPES as readonly DrivingEventType[]).includes(type);
}

type AnalyzerState = {
  config: DetectorConfig;
  sessionId: string;
  startedAtMs: number;
  trigger: TripTrigger;
  capture?: NativeStartOptions;
  device: DeviceInfo;
  location: LocationSample[];
  imu: ImuSample[];
  events: DrivingEvent[];
  /** Sharp speed step waiting for the next fix to confirm or drop it. */
  heldSpeedLeap: LocationSample | null;
  lastEventAt: Partial<Record<DrivingEventType, number>>;
  lastEventLevel: Partial<Record<DrivingEventType, HarshEventLevel>>;
  smoothHold: Partial<Record<SmoothDrivingEventType, SmoothHold>>;
  /**
   * Path-only harsh corner candidate. Chip/gyro-confirmed laterals emit without this hold.
   */
  harshCornerHold: SmoothHold | null;
  /** Latest GPS lateral came from path heading without chip/gyro confirm. */
  pathOnlyLateral: boolean;
  /** Trip distance when this type last earned a credit. */
  smoothCreditAtM: Partial<Record<SmoothDrivingEventType, number>>;
  /** 0-based kilometre indexes that contain a harsh driving event. */
  spoiledKm: Set<number>;
  /** How many kilometre buckets have already been closed. */
  awardedKm: number;
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
  /** Prior GPS-window yaw for swerve onset (jerk). */
  prevYawRateRadps: number | null;
  prevYawAtT: number | null;
  yawJerkRadps2: number | null;
  /** Brief elevated-yaw episode awaiting a drop (lane flick vs sustained turn). */
  swerveElevatedSinceT: number | null;
  swerveElevatedPeak: number;
  swerveElevatedRiseJerk: number;
  swerveElevatedAtSpeed: number | null;
  /** True if any elevated sample lacked gyro confirmation. */
  swerveElevatedPathOnly: boolean;
  /** Latest GPS step used to decide a harsh brake. */
  gpsBrake: GpsBrakeSample;
  /** Last time GPS speed was still at or above `minSpeedMps`. */
  lastMovingAtMs: number | null;
  /** Phone-frame unit vector pointing toward vehicle forward. */
  brakeForward: Vec3 | null;
  /** Gravity when `brakeForward` was last learned. */
  brakeForwardGravity: Vec3 | null;
  imuBrakeSinceT: number | null;
  imuBrakeLastT: number | null;
  imuBrakePeak: number;
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
    smooth_accel: 0,
    smooth_brake: 0,
    smooth_corner: 0,
    smooth_km: 0,
  };
}

const KILOMETRE_SPOILERS = new Set<DrivingEventType>([
  "harsh_accel",
  "harsh_brake",
  "harsh_corner",
  "swerve",
  "jerk",
]);

function noteHarshKilometre(state: AnalyzerState, type: DrivingEventType): void {
  if (!KILOMETRE_SPOILERS.has(type)) {
    return;
  }
  state.spoiledKm.add(Math.floor(state.distanceM / 1000));
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
      noteHarshKilometre(state, type);
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
  noteHarshKilometre(state, type);
  return event;
}

/** Match fused GPS fallback cadence (`GPS_STALE_MS` 8 s). */
const GPS_ACCEL_MIN_DT_SEC = 0.2;
const GPS_ACCEL_MAX_DT_SEC = 8;

type GpsWindowAccel = GpsBrakeSample & {
  lateral: number | null;
  yawRateRadps: number | null;
  pathOnlyLateral: boolean;
};

function emptyGpsWindow(): GpsWindowAccel {
  return {
    longitudinal: null,
    lateral: null,
    yawRateRadps: null,
    pathOnlyLateral: false,
    entrySpeedMps: null,
    exitSpeedMps: null,
    dtSec: null,
    stepM: null,
  };
}

function gpsWindowAccel(state: AnalyzerState): GpsWindowAccel {
  const { gpsAccelWindowMs } = state.config;
  const current = state.lastGoodLocation;
  if (!current || current.speedMps == null) {
    return emptyGpsWindow();
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
    return emptyGpsWindow();
  }

  const dtSec = (current.t - previous.t) / 1000;
  if (dtSec < GPS_ACCEL_MIN_DT_SEC || dtSec > GPS_ACCEL_MAX_DT_SEC) {
    return emptyGpsWindow();
  }

  const longitudinal = (current.speedMps - previous.speedMps) / dtSec;
  const previousIndex = state.location.lastIndexOf(previous);
  const before = previousIndex > 0 ? state.location[previousIndex - 1] : null;
  const pathMinM = pathBearingMinM(previous.accuracyM, current.accuracyM);
  const yaw = confirmedYawDetail({
    dtSec,
    chipFromDeg: previous.courseDeg,
    chipToDeg: current.courseDeg,
    pathFromDeg: pathBearingDeg(before, previous, pathMinM),
    pathToDeg: pathBearingDeg(previous, current, pathMinM),
    verticalGyroRadps: meanVerticalGyro(state, previous.t, current.t),
    phoneHandheld: state.openHandheld != null,
  });
  let lateral: number | null = null;
  let yawRateRadps: number | null = null;
  let pathOnlyLateral = false;
  const speedsOk =
    previous.speedMps >= state.config.minSpeedMps &&
    current.speedMps >= state.config.minSpeedMps;
  if (yaw.omega != null) {
    const speed = (current.speedMps + previous.speedMps) / 2;
    const nextLateral = speed * yaw.omega;
    if (yaw.pathOnly) {
      pathOnlyLateral = true;
      const hasAcc = previous.accuracyM != null || current.accuracyM != null;
      const worstAcc = Math.max(previous.accuracyM ?? 0, current.accuracyM ?? 0);
      if (hasAcc && worstAcc > PATH_ONLY_CORNER_MAX_ACCURACY_M) {
        lateral = null;
      } else if (Math.abs(nextLateral) > PATH_ONLY_LATERAL_MAX_MPS2) {
        lateral = null;
      } else {
        lateral = nextLateral;
      }
    } else {
      lateral = nextLateral;
    }
    if (speedsOk) {
      yawRateRadps = Math.abs(yaw.omega);
    }
  } else if (speedsOk) {
    // No heading signal — treat as straight so the next flick has an onset baseline.
    yawRateRadps = 0;
  }

  return {
    longitudinal,
    lateral,
    yawRateRadps,
    pathOnlyLateral,
    entrySpeedMps: previous.speedMps,
    exitSpeedMps: current.speedMps,
    dtSec,
    stepM: haversineM(previous, current),
  };
}

/** Path chords shorter than accuracy noise are not a reliable heading. */
function pathBearingMinM(prevAccuracyM: number | null, currAccuracyM: number | null): number {
  const worst = Math.max(prevAccuracyM ?? 0, currAccuracyM ?? 0);
  if (worst <= 0) {
    return DERIVED_COURSE_MIN_M;
  }
  return Math.max(DERIVED_COURSE_MIN_M, Math.min(worst * 0.5, 15));
}

function meanVerticalGyro(state: AnalyzerState, fromT: number, toT: number): number | null {
  let sum = 0;
  let count = 0;
  for (let i = state.imu.length - 1; i >= 0; i -= 1) {
    const sample = state.imu[i];
    if (!sample || sample.t > toT) {
      continue;
    }
    if (sample.t < fromT) {
      break;
    }
    const yaw = verticalGyroRadps(sample.gyro, sample.gravity);
    if (yaw == null) {
      continue;
    }
    sum += yaw;
    count += 1;
  }
  return count === 0 ? null : sum / count;
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

function clearBrakeAxis(state: AnalyzerState): void {
  state.brakeForward = null;
  state.brakeForwardGravity = null;
  state.imuBrakeSinceT = null;
  state.imuBrakeLastT = null;
  state.imuBrakePeak = 0;
}

function copyVec(vector: Vec3): Vec3 {
  return { x: vector.x, y: vector.y, z: vector.z };
}

/** Learn or drop the phone-frame forward axis, then hold a horizontal brake. */
function resolveImuBrake(state: AnalyzerState, sample: ImuSample, t: number): number | null {
  if (state.openHandheld != null) {
    clearBrakeAxis(state);
    return null;
  }
  const gravity = sample.gravity;
  if (
    state.brakeForward != null &&
    gravityTiltDeg(state.brakeForwardGravity, gravity) > IMU_BRAKE_AXIS_TILT_DEG
  ) {
    clearBrakeAxis(state);
    return null;
  }

  const speed = currentSpeed(state);
  const gpsLong = state.longitudinalAccelMps2;
  const linear = sampleLinearAccel(sample);
  const share = verticalShare(linear, gravity);
  if (
    speed != null &&
    speed >= IMU_BRAKE_LEARN_MIN_MPS &&
    gpsLong != null &&
    share <= state.config.impactVerticalMax
  ) {
    const pointed = forwardSampleFromGps(horizontalLinear(linear, gravity), gpsLong);
    if (pointed) {
      state.brakeForward = blendForwardAxis(state.brakeForward, pointed);
      state.brakeForwardGravity = gravity ? copyVec(gravity) : null;
    }
  }

  const forward = state.brakeForward;
  const lastMoving = state.lastMovingAtMs;
  const settled = t - state.startedAtMs >= state.config.jerkSettleMs;
  const recent = lastMoving != null && t - lastMoving <= IMU_BRAKE_RECENT_MS;
  const braking =
    forward == null ? 0 : brakeAlongForward(horizontalLinear(linear, gravity), forward);
  const holding =
    forward != null &&
    settled &&
    recent &&
    share <= state.config.impactVerticalMax &&
    braking >= state.config.harshBrakeMps2;
  if (!holding) {
    state.imuBrakeSinceT = null;
    state.imuBrakeLastT = null;
    state.imuBrakePeak = 0;
    return null;
  }
  if (
    state.imuBrakeSinceT == null ||
    state.imuBrakeLastT == null ||
    t - state.imuBrakeLastT > IMU_BRAKE_GAP_MS
  ) {
    state.imuBrakeSinceT = t;
    state.imuBrakePeak = braking;
  }
  state.imuBrakeLastT = t;
  state.imuBrakePeak = Math.max(state.imuBrakePeak, braking);
  if (t - state.imuBrakeSinceT < IMU_BRAKE_HOLD_MS) {
    return null;
  }
  return state.imuBrakePeak;
}

function detectFromMotion(
  state: AnalyzerState,
  t: number,
  includeSmooth = false,
): DrivingEvent[] {
  const emitted: DrivingEvent[] = [];
  const speed = currentSpeed(state);
  const moving = speed != null && speed >= state.config.minSpeedMps;
  const location = state.lastGoodLocation;

  const speeding = updateSpeedingSpan(state, t, speed, location, moving);
  if (speeding) {
    emitted.push(speeding);
  }

  const longAccel = state.longitudinalAccelMps2;
  if (moving && longAccel != null && longAccel >= state.config.harshAccelMps2) {
    const event = maybeEmit(
      state,
      "harsh_accel",
      t,
      longAccel,
      state.config.harshAccelMps2,
      location,
      speed,
    );
    if (event) {
      emitted.push(event);
    }
  } else if (
    gpsHarshBrakeQualifies(state.gpsBrake, state.config.minSpeedMps, state.config.harshBrakeMps2)
  ) {
    const event = maybeEmit(
      state,
      "harsh_brake",
      t,
      Math.abs(longAccel ?? 0),
      state.config.harshBrakeMps2,
      location,
      speed,
    );
    if (event) {
      emitted.push(event);
    }
  }

  if (!includeSmooth && state.lastImu) {
    const imuBrake = resolveImuBrake(state, state.lastImu, t);
    if (imuBrake != null) {
      const event = maybeEmit(
        state,
        "harsh_brake",
        t,
        imuBrake,
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
    const event = state.pathOnlyLateral
      ? resolvePathOnlyHarshCorner(state, t, location, speed)
      : maybeEmit(
          state,
          "harsh_corner",
          t,
          Math.abs(state.lateralAccelMps2),
          state.config.harshCornerMps2,
          location,
          speed,
        );
    if (!state.pathOnlyLateral) {
      state.harshCornerHold = null;
    }
    if (event) {
      emitted.push(event);
    }
  } else {
    state.harshCornerHold = null;
  }

  const yaw = state.yawRateRadps;
  const swervePeak = resolveSwervePeak(state, t, speed, cornering, yaw);
  if (swervePeak != null) {
    const event = maybeEmit(
      state,
      "swerve",
      t,
      swervePeak,
      state.config.harshSwerveRadps,
      location,
      speed,
    );
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

  if (includeSmooth) {
    emitted.push(...updateSmoothCredits(state, t, moving, location, speed));
    emitted.push(...awardCleanKilometres(state, t, location, speed));
  }

  return emitted;
}

/**
 * Track a brief elevated-yaw episode. Emit when yaw falls again within
 * `swerveMaxElevatedMs` after a sharp rise — sustained turns stay elevated and are ignored.
 */
function resolveSwervePeak(
  state: AnalyzerState,
  t: number,
  speed: number | null,
  cornering: boolean,
  yaw: number | null,
): number | null {
  const thr = state.config.harshSwerveRadps;
  const exitThr = thr * 0.5;
  if (yaw == null) {
    state.swerveElevatedSinceT = null;
    state.swerveElevatedPeak = 0;
    state.swerveElevatedRiseJerk = 0;
    state.swerveElevatedAtSpeed = null;
    state.swerveElevatedPathOnly = false;
    return null;
  }

  if (yaw >= thr) {
    if (state.swerveElevatedSinceT == null) {
      state.swerveElevatedSinceT = t;
      state.swerveElevatedPeak = yaw;
      state.swerveElevatedRiseJerk = state.yawJerkRadps2 ?? 0;
      state.swerveElevatedAtSpeed = speed;
      state.swerveElevatedPathOnly = state.pathOnlyLateral;
    } else {
      if (yaw > state.swerveElevatedPeak) {
        state.swerveElevatedPeak = yaw;
      }
      if (state.yawJerkRadps2 != null && state.yawJerkRadps2 > state.swerveElevatedRiseJerk) {
        state.swerveElevatedRiseJerk = state.yawJerkRadps2;
      }
      if (speed != null) {
        state.swerveElevatedAtSpeed =
          state.swerveElevatedAtSpeed == null
            ? speed
            : Math.max(state.swerveElevatedAtSpeed, speed);
      }
      if (state.pathOnlyLateral) {
        state.swerveElevatedPathOnly = true;
      }
    }
    return null;
  }

  if (state.swerveElevatedSinceT == null) {
    return null;
  }

  const elevatedMs = t - state.swerveElevatedSinceT;
  const peak = state.swerveElevatedPeak;
  const riseJerk = state.swerveElevatedRiseJerk;
  const peakSpeed = state.swerveElevatedAtSpeed;
  const pathOnly = state.swerveElevatedPathOnly;
  state.swerveElevatedSinceT = null;
  state.swerveElevatedPeak = 0;
  state.swerveElevatedRiseJerk = 0;
  state.swerveElevatedAtSpeed = null;
  state.swerveElevatedPathOnly = false;

  if (yaw > exitThr) {
    return null;
  }

  if (pathOnly) {
    return null;
  }

  if (
    isSwerveMotion({
      speedMps: peakSpeed ?? speed,
      cornering,
      peakYawRadps: peak,
      riseJerkRadps2: riseJerk,
      elevatedMs,
      config: state.config,
    })
  ) {
    return peak;
  }
  return null;
}

function awardCleanKilometres(
  state: AnalyzerState,
  t: number,
  location: LocationSample | null,
  speed: number | null,
): DrivingEvent[] {
  const emitted: DrivingEvent[] = [];
  while (state.distanceM >= (state.awardedKm + 1) * 1000) {
    const index = state.awardedKm;
    state.awardedKm += 1;
    if (state.spoiledKm.has(index)) {
      continue;
    }
    const kmNumber = index + 1;
    const points = kmNumber <= 10 ? 2 : 1;
    const event: DrivingEvent = {
      id: `smooth_km-${kmNumber}`,
      type: "smooth_km",
      t,
      endT: null,
      peak: points,
      severity: 0,
      level: "light",
      lat: location?.lat ?? null,
      lon: location?.lon ?? null,
      speedMps: speed,
      overlaps: [],
    };
    state.events.push(event);
    emitted.push(event);
  }
  return emitted;
}

function smoothMagnitude(
  type: SmoothDrivingEventType,
  longitudinal: number | null,
  lateral: number | null,
  config: DetectorConfig,
): number | null {
  let magnitude: number | null = null;
  let harsh = 0;
  if (type === "smooth_accel") {
    if (longitudinal == null || longitudinal <= 0) {
      return null;
    }
    magnitude = longitudinal;
    harsh = config.harshAccelMps2;
  } else if (type === "smooth_brake") {
    if (longitudinal == null || longitudinal >= 0) {
      return null;
    }
    magnitude = -longitudinal;
    harsh = config.harshBrakeMps2;
  } else {
    if (lateral == null) {
      return null;
    }
    magnitude = Math.abs(lateral);
    harsh = config.harshCornerMps2;
  }
  const ceiling = harsh * SMOOTH_CEILING_X;
  const floor = type === "smooth_corner" ? SMOOTH_FLOOR_MPS2 : SMOOTH_CREEP_FLOOR_MPS2;
  if (ceiling < floor || magnitude < floor || magnitude > ceiling) {
    return null;
  }
  return magnitude;
}

/** Latest displacement bearing (≥2 m step). Null when the track is too short. */
function latestPathHeadingDeg(state: AnalyzerState): number | null {
  const current = state.lastGoodLocation;
  if (!current) {
    return null;
  }
  for (let i = state.location.length - 2; i >= 0; i -= 1) {
    const previous = state.location[i];
    if (!previous) {
      continue;
    }
    const bearing = pathBearingDeg(previous, current);
    if (bearing != null) {
      return bearing;
    }
    if (current.t - previous.t > GPS_ACCEL_MAX_DT_SEC * 1000) {
      break;
    }
  }
  return null;
}

/**
 * Path-only harsh corners need same-sign lateral held with a real heading change.
 * Zig-zag GPS at the start of a trip flips sign and never commits.
 */
function resolvePathOnlyHarshCorner(
  state: AnalyzerState,
  t: number,
  location: LocationSample | null,
  speed: number | null,
): DrivingEvent | null {
  const lateral = state.lateralAccelMps2;
  if (lateral == null || lateral === 0) {
    state.harshCornerHold = null;
    return null;
  }
  const sign = lateral > 0 ? 1 : -1;
  const magnitude = Math.abs(lateral);
  const heading = latestPathHeadingDeg(state);
  if (heading == null) {
    state.harshCornerHold = null;
    return null;
  }
  const hold = state.harshCornerHold;
  if (!hold || hold.sign !== sign) {
    state.harshCornerHold = {
      sinceT: t,
      sinceDistanceM: state.distanceM,
      peak: magnitude,
      sign,
      headingAtStartDeg: heading,
    };
    return null;
  }
  hold.peak = Math.max(hold.peak, magnitude);
  const heldMs = t - hold.sinceT;
  const movedM = state.distanceM - hold.sinceDistanceM;
  if (heldMs < HARSH_CORNER_HOLD_MS || movedM < HARSH_CORNER_HOLD_MIN_M) {
    return null;
  }
  const startHeading = hold.headingAtStartDeg;
  if (
    startHeading == null ||
    Math.abs(unwrapDeltaDeg(startHeading, heading)) < HARSH_CORNER_MIN_TURN_DEG
  ) {
    return null;
  }
  state.harshCornerHold = null;
  return maybeEmit(
    state,
    "harsh_corner",
    t,
    hold.peak,
    state.config.harshCornerMps2,
    location,
    speed,
  );
}

function updateSmoothCredits(
  state: AnalyzerState,
  t: number,
  moving: boolean,
  location: LocationSample | null,
  speed: number | null,
): DrivingEvent[] {
  const emitted: DrivingEvent[] = [];
  for (const type of SMOOTH_TYPES) {
    const magnitude = moving
      ? smoothMagnitude(
          type,
          state.longitudinalAccelMps2,
          state.lateralAccelMps2,
          state.config,
        )
      : null;
    if (magnitude == null) {
      delete state.smoothHold[type];
      continue;
    }

    if (type === "smooth_corner") {
      const lateral = state.lateralAccelMps2;
      if (lateral == null || lateral === 0) {
        delete state.smoothHold[type];
        continue;
      }
      const sign = lateral > 0 ? 1 : -1;
      const heading = latestPathHeadingDeg(state);
      if (heading == null) {
        delete state.smoothHold[type];
        continue;
      }
      const hold = state.smoothHold[type];
      if (!hold || hold.sign !== sign) {
        state.smoothHold[type] = {
          sinceT: t,
          sinceDistanceM: state.distanceM,
          peak: magnitude,
          sign,
          headingAtStartDeg: heading,
        };
        continue;
      }
      hold.peak = Math.max(hold.peak, magnitude);
      const heldMs = t - hold.sinceT;
      const movedM = state.distanceM - hold.sinceDistanceM;
      if (heldMs < SMOOTH_HOLD_MS || movedM < SMOOTH_HOLD_MIN_M) {
        continue;
      }
      const startHeading = hold.headingAtStartDeg;
      if (
        startHeading == null ||
        Math.abs(unwrapDeltaDeg(startHeading, heading)) < SMOOTH_CORNER_MIN_TURN_DEG
      ) {
        continue;
      }
      const lastCreditM = state.smoothCreditAtM[type];
      if (lastCreditM != null && state.distanceM - lastCreditM < SMOOTH_GAP_M) {
        continue;
      }
      const event: DrivingEvent = {
        id: `${type}-${t}`,
        type,
        t,
        endT: null,
        peak: hold.peak,
        severity: 0,
        level: "light",
        lat: location?.lat ?? null,
        lon: location?.lon ?? null,
        speedMps: speed,
        overlaps: [],
      };
      state.events.push(event);
      state.smoothCreditAtM[type] = state.distanceM;
      delete state.smoothHold[type];
      emitted.push(event);
      continue;
    }

    const hold = state.smoothHold[type];
    if (!hold) {
      state.smoothHold[type] = {
        sinceT: t,
        sinceDistanceM: state.distanceM,
        peak: magnitude,
        speedAtStartMps: speed ?? undefined,
      };
      continue;
    }
    hold.peak = Math.max(hold.peak, magnitude);
    const heldMs = t - hold.sinceT;
    const movedM = state.distanceM - hold.sinceDistanceM;
    const creep = hold.peak < SMOOTH_FLOOR_MPS2;
    if (creep) {
      const delta =
        speed != null && hold.speedAtStartMps != null
          ? Math.abs(speed - hold.speedAtStartMps)
          : 0;
      if (
        heldMs < SMOOTH_CREEP_HOLD_MS ||
        movedM < SMOOTH_CREEP_HOLD_MIN_M ||
        delta < SMOOTH_CREEP_MIN_SPEED_DELTA_MPS
      ) {
        continue;
      }
    } else if (heldMs < SMOOTH_HOLD_MS || movedM < SMOOTH_HOLD_MIN_M) {
      continue;
    }
    const lastCreditM = state.smoothCreditAtM[type];
    if (lastCreditM != null && state.distanceM - lastCreditM < SMOOTH_GAP_M) {
      continue;
    }
    const event: DrivingEvent = {
      id: `${type}-${t}`,
      type,
      t,
      endT: null,
      peak: hold.peak,
      severity: 0,
      level: "light",
      lat: location?.lat ?? null,
      lon: location?.lon ?? null,
      speedMps: speed,
      overlaps: [],
    };
    state.events.push(event);
    state.smoothCreditAtM[type] = state.distanceM;
    delete state.smoothHold[type];
    emitted.push(event);
  }
  return emitted;
}

function buildMetrics(state: AnalyzerState, t: number): LiveMetrics {
  const durationMs = Math.max(0, t - state.startedAtMs);
  const speedMps = currentSpeed(state);
  const moving = speedMps != null && speedMps >= state.config.minSpeedMps;
  const cornering =
    moving &&
    state.lateralAccelMps2 != null &&
    Math.abs(state.lateralAccelMps2) >= state.config.harshCornerMps2;
  const elevatedMs =
    state.swerveElevatedSinceT == null ? null : t - state.swerveElevatedSinceT;
  const liveSwerve =
    state.swerveElevatedSinceT != null &&
    elevatedMs != null &&
    elevatedMs <= state.config.swerveMaxElevatedMs &&
    isSwerveMotion({
      speedMps: state.swerveElevatedAtSpeed ?? speedMps,
      cornering,
      peakYawRadps: state.swerveElevatedPeak,
      riseJerkRadps2: state.swerveElevatedRiseJerk,
      elevatedMs: Math.max(elevatedMs, 1),
      config: state.config,
    });
  const swerveYaw = liveSwerve ? state.swerveElevatedPeak : null;
  const levels = liveHarshLevels({
    moving,
    longitudinal: state.longitudinalAccelMps2,
    lateral: state.lateralAccelMps2,
    yawRateRadps: swerveYaw,
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
    ...tripScoreFields(state.events, state.config, {
      distanceM: state.distanceM,
      durationMs,
    }),
  };
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
  void durationMs;
  const km = Math.max(distanceM / 1000, config.score.minDistanceKm);
  const exposure = km / config.score.refDistanceKm;
  return clamp(1 / Math.max(exposure, 1e-6), SCORE_EXPOSURE_MIN, SCORE_EXPOSURE_MAX);
}

/** Absolute event-point ledger. Capped at SCORE_MAX; may go negative. */
export function scoreEvents(
  events: readonly DrivingEvent[],
  config: DetectorConfig,
  exposure: { distanceM: number; durationMs: number },
): number {
  void config;
  void exposure;
  let sum = 0;
  for (const event of events) {
    sum += eventScorePoints(event, config, exposure.distanceM);
  }
  return Math.min(sum, SCORE_MAX);
}

export function tripScoreFields(
  events: readonly DrivingEvent[],
  config: DetectorConfig,
  exposure: { distanceM: number; durationMs: number },
): { points: number; score: number } {
  const points = scoreEvents(events, config, exposure);
  return {
    points,
    score: relativeScore(points, exposure.distanceM, config.score),
  };
}

function harshBandPoints(
  level: HarshEventLevel | undefined,
  light: number,
  medium: number,
  heavy: number,
): number {
  if (level === "heavy") {
    return heavy;
  }
  if (level === "medium") {
    return medium;
  }
  return light;
}

/**
 * Fixed points for one event. Distance, time, and severity do not change them.
 * Overlaps do not add a further amount.
 */
export function eventScorePoints(
  event: Pick<DrivingEvent, "type"> & {
    peak?: number;
    level?: HarshEventLevel;
    severity?: number;
    overlaps?: readonly string[];
  },
  config: DetectorConfig,
  distanceM: number,
): number {
  void config;
  void distanceM;
  void event.severity;
  void event.overlaps;
  switch (event.type) {
    case "smooth_km": {
      // Peak stores the credit. Older trips kept 3 then 2; new trips store 2 then 1.
      const stored = event.peak ?? 3;
      if (stored >= 2.5) {
        return 3;
      }
      if (stored >= 1.5) {
        return 2;
      }
      return 1;
    }
    case "smooth_accel":
    case "smooth_brake":
      return (event.peak ?? SMOOTH_FLOOR_MPS2) < SMOOTH_FLOOR_MPS2 ? 1 : 2;
    case "smooth_corner":
      return 2;
    case "harsh_accel":
      return harshBandPoints(event.level, -5, -8, -12);
    case "harsh_brake":
      return harshBandPoints(event.level, -8, -12, -16);
    case "harsh_corner":
      return harshBandPoints(event.level, -4, -8, -12);
    case "swerve":
      return harshBandPoints(event.level, -4, -7, -10);
    case "jerk":
      return harshBandPoints(event.level, -3, -5, -6);
    default:
      return 0;
  }
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
    ...tripScoreFields(state.events, state.config, {
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
  const maxImu = options.maxImuSamples ?? maxImuSamples(options.imuHz ?? 50);
  const state: AnalyzerState = {
    config: mergeDetectorConfig(configInput),
    sessionId: options.sessionId,
    startedAtMs: options.startedAtMs,
    trigger: options.trigger ?? "manual",
    capture: options.capture,
    device: options.device,
    location: [],
    imu: [],
    events: [],
    lastEventAt: {},
    lastEventLevel: {},
    smoothHold: {},
    harshCornerHold: null,
    pathOnlyLateral: false,
    smoothCreditAtM: {},
    spoiledKm: new Set(),
    awardedKm: 0,
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
    gpsBrake: {
      longitudinal: null,
      entrySpeedMps: null,
      exitSpeedMps: null,
      dtSec: null,
      stepM: null,
    },
    lastMovingAtMs: null,
    brakeForward: null,
    brakeForwardGravity: null,
    imuBrakeSinceT: null,
    imuBrakeLastT: null,
    imuBrakePeak: 0,
    yawRateRadps: null,
    prevYawRateRadps: null,
    prevYawAtT: null,
    yawJerkRadps2: null,
    swerveElevatedSinceT: null,
    swerveElevatedPeak: 0,
    swerveElevatedRiseJerk: 0,
    swerveElevatedAtSpeed: null,
    swerveElevatedPathOnly: false,
    maxSpeedMps: null,
    speedSum: 0,
    speedCount: 0,
    heldSpeedLeap: null,
  };

  const commitLocation = (sample: LocationSample) => {

    const withRoad: LocationSample = {
      ...sample,
      speedMps: derivedSpeedMps(state.lastGoodLocation, sample) ?? sample.speedMps,
      // Keep the OS chip course as-is. Filling from the path made every yaw look
      // chip-confirmed and defeated path-only GPS noise gates.
      courseDeg: sample.courseDeg,
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
      const prevGood = state.lastGoodLocation;
      if (prevGood) {
        state.distanceM += haversineM(prevGood, withRoad);
      }
      state.lastGoodLocation = withRoad;
      state.heading = advanceHeadingFilter(
        state.heading,
        {
          ...withRoad,
          courseDeg: derivedCourseDeg(prevGood, sample),
        },
        state.config.minSpeedMps,
      );
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
    state.pathOnlyLateral = accel.pathOnlyLateral;
    state.gpsBrake = {
      longitudinal: accel.longitudinal,
      entrySpeedMps: accel.entrySpeedMps,
      exitSpeedMps: accel.exitSpeedMps,
      dtSec: accel.dtSec,
      stepM: accel.stepM,
    };
    if (withRoad.speedMps != null && withRoad.speedMps >= state.config.minSpeedMps) {
      state.lastMovingAtMs = withRoad.t;
    }
    const yaw = accel.yawRateRadps;
    state.yawJerkRadps2 =
      yaw == null
        ? null
        : yawRateJerkRadps2(yaw, withRoad.t, state.prevYawRateRadps, state.prevYawAtT);
    const motion = detectFromMotion(state, withRoad.t, true);
    const impact = resolvePendingImpact(state, withRoad.t, false);
    if (yaw == null) {
      state.prevYawRateRadps = null;
      state.prevYawAtT = null;
    } else {
      state.prevYawRateRadps = yaw;
      state.prevYawAtT = withRoad.t;
    }
    const newEvents = impact ? [...motion, impact] : motion;
    return { metrics: buildMetrics(state, withRoad.t), newEvents };
  };

  const pushLocation = (sample: LocationSample) => {
    const carried: DrivingEvent[] = [];
    if (state.heldSpeedLeap) {
      const held = state.heldSpeedLeap;
      state.heldSpeedLeap = null;
      const anchor = lastLocationAnchor(state.location);
      if (anchor == null || speedLeapHolds(anchor, held, sample)) {
        carried.push(...commitLocation(held).newEvents);
      }
    }

    const anchor = lastLocationAnchor(state.location);
    const decision = shouldAcceptDriveFix(anchor, sample, state.locationRejects);
    state.locationRejects = decision.rejects;
    if (!decision.accept) {
      const t =
        state.lastGoodLocation?.t ?? state.lastImu?.t ?? state.startedAtMs;
      return { metrics: buildMetrics(state, t), newEvents: carried };
    }
    if (anchor != null && isSuspiciousSpeedLeap(anchor, sample)) {
      state.heldSpeedLeap = sample;
      const t =
        state.lastGoodLocation?.t ?? state.lastImu?.t ?? state.startedAtMs;
      return { metrics: buildMetrics(state, t), newEvents: carried };
    }
    const committed = commitLocation(sample);
    return {
      metrics: committed.metrics,
      newEvents: [...carried, ...committed.newEvents],
    };
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
        sdkVersion: HARSHY_SDK_VERSION,
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
        ...(state.capture ? { capture: state.capture } : {}),
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
  capture?: NativeStartOptions;
}): SessionExport {
  const analyzer = createTripAnalyzer(input.config, {
    sessionId: input.sessionId,
    startedAtMs: input.startedAtMs,
    device: input.device,
    trigger: input.trigger,
    capture: input.capture,
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
