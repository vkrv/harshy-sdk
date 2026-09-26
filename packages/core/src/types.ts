export type Vec3 = {
  x: number;
  y: number;
  z: number;
};

export type Attitude = {
  pitch: number;
  roll: number;
  yaw: number;
};

export type LocationSample = {
  t: number;
  lat: number;
  lon: number;
  altitudeM: number | null;
  speedMps: number | null;
  courseDeg: number | null;
  accuracyM: number | null;
  altitudeAccuracyM: number | null;
  /** Vertical linear-accel RMS (m/s²) over ~1 s. Omitted on older trips. Not a score input. */
  roadRmsMps2?: number | null;
};

export type ImuSample = {
  t: number;
  accel: Vec3;
  linearAccel: Vec3 | null;
  gyro: Vec3 | null;
  magnetometer: Vec3 | null;
  attitude: Attitude | null;
  gravity: Vec3 | null;
  barometerHpa: number | null;
};

export type DrivingEventType =
  | "harsh_accel"
  | "harsh_brake"
  | "harsh_corner"
  | "swerve"
  | "speeding"
  | "jerk"
  | "possible_impact"
  | "phone_handheld";

/** Honest v1 impact axis. Not left/right or a body panel. */
export type ImpactDirection = "front" | "rear" | "rollover" | "unknown";

export type HarshLevel = "norm" | "light" | "medium" | "heavy";

/** Emitted events are never `norm`. */
export type HarshEventLevel = Exclude<HarshLevel, "norm">;

export type DrivingEvent = {
  id: string;
  type: DrivingEventType;
  t: number;
  endT: number | null;
  peak: number;
  /** Continuous 0–1 score weight factor. Discrete bands live on `level`. */
  severity: number;
  /** Light / medium / heavy vs the type threshold. Absent on pre-level JSON. */
  level: HarshEventLevel;
  lat: number | null;
  lon: number | null;
  speedMps: number | null;
  /** Other kinematic types overlapping this event. Empty when none. */
  overlaps: DrivingEventType[];
  /** Set on `possible_impact` when the axis is honest. Absent on older JSON. */
  impactDirection?: ImpactDirection;
};

export type LiveMetrics = {
  t: number;
  speedMps: number | null;
  speedKmh: number | null;
  /** Live display heading (held/smoothed). Raw GPS `courseDeg` stays on location samples. */
  headingDeg: number | null;
  altitudeM: number | null;
  locationAccuracyM: number | null;
  longitudinalAccelMps2: number | null;
  lateralAccelMps2: number | null;
  verticalAccelMps2: number | null;
  accelMagnitudeMps2: number | null;
  gyroMagnitudeRadps: number | null;
  accelLevel: HarshLevel;
  brakeLevel: HarshLevel;
  cornerLevel: HarshLevel;
  yawRateRadps: number | null;
  swerveLevel: HarshLevel;
  distanceM: number;
  durationMs: number;
  score: number;
};

export type DetectorScoreWeights = {
  start: number;
  harshAccel: number;
  harshBrake: number;
  harshCorner: number;
  swerve: number;
  speeding: number;
  jerk: number;
  /** Extra penalty when a kinematic event overlaps another type. */
  compound: number;
  /** Distance at which event penalties are applied 1:1. Duration does not scale the score. */
  refDistanceKm: number;
  /** Kept so older session JSON still parses. Not used in the score. */
  refDurationMin: number;
  /** Floor so a 50 m start does not explode live penalties. */
  minDistanceKm: number;
  /** Kept so older session JSON still parses. Not used in the score. */
  minDurationMin: number;
};

export type DetectorConfig = {
  harshAccelMps2: number;
  harshBrakeMps2: number;
  harshCornerMps2: number;
  /** Peak / threshold at which a harsh event becomes medium. */
  harshMediumX: number;
  /** Peak / threshold at which a harsh event becomes heavy. */
  harshHeavyX: number;
  /** |GPS yaw rate| for a swerve (rad/s). Phone gyro is ignored. Corners win when lateral g is also harsh. */
  harshSwerveRadps: number;
  speedingMps: number | null;
  /** Drop below `speedingMps * speedingExitX` to close a speeding span. */
  speedingExitX: number;
  minSpeedMps: number;
  cooldownMs: number;
  /** How close two kinematic events may be to count as overlapping. */
  compoundWindowMs: number;
  /** Ignore IMU jerk for this long after `startedAtMs` (haptic / picking up the phone). */
  jerkSettleMs: number;
  gpsAccelWindowMs: number;
  maxLocationAccuracyM: number;
  /** Open an impact pulse above this linear-accel magnitude (~1.5 g). */
  impactFloorMps2: number;
  /** Peak linear-accel magnitude for a possible impact (~3.5 g). */
  impactPeakMps2: number;
  /** Peak that can emit without a GPS speed change (~6 g). */
  impactPeakHighMps2: number;
  /** Pulses longer than this are accel/brake, not a collision. */
  impactPulseMaxMs: number;
  /** |Δspeed| that corroborates an impact. 0 skips the GPS check. */
  impactSpeedDeltaMps: number;
  /** Wait this long after the peak for a GPS speed change. */
  impactLookaheadMs: number;
  /** Separate from harsh `cooldownMs`. Possible impact does not band-upgrade. */
  impactCooldownMs: number;
  /** Peak linear accel that is mostly world-up is a pothole. */
  impactVerticalMax: number;
  /** Full |accel| below this before the pulse is a phone drop, not a crash. */
  impactFreeFallMps2: number;
  impactFreeFallLookbackMs: number;
  /** Gravity vector rotation over the pulse that counts as rollover. */
  impactRolloverDeg: number;
  /** Gravity tilt from the mount baseline that opens a handheld span (degrees). */
  handheldTiltDeg: number;
  /** Close the handheld span when tilt stays below this. */
  handheldExitTiltDeg: number;
  /** Gyro magnitude that counts as picking up / handling the phone. */
  handheldGyroRadps: number;
  /** Linear-accel magnitude that counts as handling. */
  handheldMotionMps2: number;
  /** Quiet gyro for refreshing the mount baseline. */
  handheldQuietGyroRadps: number;
  /** Quiet linear accel for refreshing the mount baseline. */
  handheldQuietMotionMps2: number;
  /** How long the phone must stay quiet before the mount baseline updates. */
  handheldStableMs: number;
  /** Pickup must stay tilted + handling this long before opening a span. */
  handheldConfirmMs: number;
  /** How long tilt must stay below exit (or the car stopped) before closing. */
  handheldExitMs: number;
  /** Gap after a closed handheld span before another can open. */
  handheldCooldownMs: number;
  /** EMA toward gravity while docked and quiet. */
  handheldBaselineAlpha: number;
  score: DetectorScoreWeights;
};

export type SensorCapabilities = {
  location: boolean;
  accelerometer: boolean;
  linearAcceleration: boolean;
  gyroscope: boolean;
  magnetometer: boolean;
  barometer: boolean;
  attitude: boolean;
  backgroundLocation: boolean;
};

export type PermissionStatus = "granted" | "denied" | "undetermined";

export type PermissionResult = {
  /** Foreground location (when-in-use / fine or coarse). Required to start a trip. */
  location: PermissionStatus;
  /** Lock-screen / background location (always / ACCESS_BACKGROUND_LOCATION). */
  backgroundLocation: PermissionStatus;
  /** Motion / activity authorization when the OS exposes it. */
  motion: PermissionStatus;
  /** Android 13+ trip notification; unused on iOS (always granted). */
  notifications: PermissionStatus;
};

export type DeviceInfo = {
  platform: "ios" | "android" | "web" | "unknown";
  model: string | null;
};

/**
 * Why the trip started. Distinct from sensor `source` (`native` / `simulated` / `auto`).
 * Omitted on older JSON; `parseSessionExport` fills `"manual"`.
 */
export type TripTrigger = "manual" | "auto";

/** Host recording preference. SDK default is manual (opt-in auto). */
export type RecordingMode = "manual" | "auto";

export type TripMetrics = {
  distanceM: number;
  durationMs: number;
  maxSpeedMps: number | null;
  avgSpeedMps: number | null;
  score: number;
  eventCounts: Record<DrivingEventType, number>;
};

export type SessionExport = {
  schemaVersion: 1;
  sessionId: string;
  startedAt: string;
  endedAt: string | null;
  config: DetectorConfig;
  location: LocationSample[];
  imu: ImuSample[];
  events: DrivingEvent[];
  metrics: TripMetrics;
  device: DeviceInfo;
  /**
   * How capture began. Always set on new `analyzeTrip` / `stop()` output.
   * Absent on pre-auto-trip JSON (`schemaVersion` stays 1).
   */
  trigger?: TripTrigger;
}

export type UploadAdapter = {
  upload: (session: SessionExport) => Promise<void>;
};

export type NativeStartOptions = {
  imuHz: number;
  locationIntervalMs: number;
  background: boolean;
  /** Why capture began. Stored on the Android trip journal; snapshot/stop echo it. */
  trigger?: TripTrigger;
};
