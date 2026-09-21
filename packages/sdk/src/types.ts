import type {
  DetectorConfig,
  DeviceInfo,
  DrivingEvent,
  DrivingEventType,
  HarshEventLevel,
  HarshLevel,
  ImpactDirection,
  ImuSample,
  LiveMetrics,
  LocationSample,
  NativeStartOptions,
  PermissionResult,
  RecordingMode,
  SensorCapabilities,
  SessionExport,
  TripHeuristicConfig,
  TripMetrics,
  TripTrigger,
  UploadAdapter,
  WatchFix,
} from "@harshy/core";

export type HarshySource = "auto" | "native" | "simulated";

export type WatchPhase = "disarmed" | "armed" | "warmup" | "recording";

/**
 * Auto-trip watch. Not a trip: sparse OS motion only.
 * `phase: "warmup" | "recording"` means a trip is running (manual or auto).
 * Warmup is an auto start that has not yet committed; a false start discards.
 */
export type WatchState = {
  mode: RecordingMode;
  phase: WatchPhase;
  /** Why the current trip started; null when idle. */
  trigger: TripTrigger | null;
  /** Manual `start()` while Auto is selected; cleared on `stop()`. */
  suppressed: boolean;
  /** Engine implements `armWatch` (native MotionWatch). Preview stubs are false. */
  nativeWatch: boolean;
  /** Latest sparse watch sample; null until the first fix. */
  lastFix: WatchFix | null;
  /** Time continuously above start speed (ms). */
  startHoldMs: number;
  /** Distance while continuously above start speed (m). */
  startDistanceM: number;
};

export type ArmWatchOptions = {
  heuristic?: Partial<TripHeuristicConfig>;
};

export type HarshyStartOptions = {
  source?: HarshySource;
  detector?: Partial<DetectorConfig>;
  native?: Partial<NativeStartOptions>;
  playbackSpeed?: number;
  device?: DeviceInfo;
  /**
   * Why this `start()` fired. Hosts should omit this (defaults to `manual`).
   * The armed watch passes `"auto"`. Distinct from sensor `source`.
   */
  trigger?: TripTrigger;
};

export type HarshyListeners = {
  onMetrics?: (metrics: LiveMetrics) => void;
  onLocation?: (sample: LocationSample) => void;
  onImu?: (sample: ImuSample) => void;
  onEvent?: (event: DrivingEvent) => void;
  onState?: (state: HarshyClientState) => void;
  onWatchState?: (state: WatchState) => void;
  onError?: (error: { code: string; message: string }) => void;
};

export type HarshyClientState = {
  running: boolean;
  /** Foreground GPS+IMU readout (not a trip). */
  previewing: boolean;
  source: HarshySource | "native" | "simulated" | "idle";
  sessionId: string | null;
  /** Wall-clock trip start while running; null when idle. */
  startedAtMs: number | null;
  nativeAvailable: boolean;
};

export type EngineSession = {
  sessionId: string | null;
  startedAtMs: number;
  endedAtMs: number;
  location: LocationSample[];
  imu: ImuSample[];
  trigger?: TripTrigger;
};

export type SensorEngine = {
  kind: "native" | "simulated";
  getCapabilities(): Promise<SensorCapabilities>;
  getPermissionStatus(): Promise<PermissionResult>;
  requestPermissions(): Promise<PermissionResult>;
  start(options: NativeStartOptions): Promise<void>;
  /**
   * Foreground GPS+IMU for a live readout. Not a trip: no FGS, journal, or session.
   * Must not disarm an armed watch. No-op while a trip is running.
   */
  startPreview?(options?: NativeStartOptions): Promise<void>;
  stopPreview?(): Promise<void>;
  stop(): Promise<EngineSession>;
  isRunning(): Promise<boolean>;
  getSnapshot(): Promise<EngineSession>;
  /** Optional: refresh lock-screen / FGS trip numbers while recording. */
  updateLiveDisplay?(payload: TripLiveDisplayPayload): Promise<void>;
  clearLiveDisplay?(): Promise<void>;
  subscribe(listeners: {
    onLocation: (sample: LocationSample) => void;
    onImu: (sample: ImuSample) => void;
    onError: (error: { code: string; message: string }) => void;
  }): () => void;
  /**
   * Sparse motion watch. Must not start trip FGS or IMU journal.
   * Simulated engines omit these.
   */
  armWatch?(options?: ArmWatchOptions): Promise<void>;
  disarmWatch?(): Promise<void>;
  subscribeWatch?(listeners: {
    onFix: (fix: WatchFix) => void;
    onError?: (error: { code: string; message: string }) => void;
  }): () => void;
};

/** Pre-formatted strings for the trip notification / Live Activity. */
export type TripLiveDisplayPayload = {
  title: string;
  score: string;
  speed: string;
  duration: string;
  distance: string;
};

export type {
  DetectorConfig,
  DeviceInfo,
  DrivingEvent,
  DrivingEventType,
  HarshEventLevel,
  HarshLevel,
  ImpactDirection,
  ImuSample,
  LiveMetrics,
  LocationSample,
  NativeStartOptions,
  PermissionResult,
  RecordingMode,
  SensorCapabilities,
  SessionExport,
  TripHeuristicConfig,
  TripMetrics,
  TripTrigger,
  UploadAdapter,
  WatchFix,
};
