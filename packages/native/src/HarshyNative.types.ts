import type { NativeStartOptions, PermissionResult, SensorCapabilities } from "@harshy/core";

export type NativeEngineState = {
  running: boolean;
  sessionId?: string;
  startedAtMs?: number;
  endedAtMs?: number;
  source?: string;
};

export type NativeEngineError = {
  code: string;
  message: string;
};

export type NativeRawSession = {
  sessionId: string | null;
  startedAtMs: number;
  endedAtMs: number;
  location: unknown[];
  imu: unknown[];
  capabilities: SensorCapabilities;
  trigger?: string;
};

export type HarshyNativeModuleEvents = {
  onLocation: (sample: Record<string, unknown>) => void;
  onImuBatch: (payload: { samples: Record<string, unknown>[] }) => void;
  onState: (state: NativeEngineState) => void;
  onError: (error: NativeEngineError) => void;
  onWatchFix: (sample: Record<string, unknown>) => void;
};

export type HarshyNativeModuleApi = {
  getCapabilities(): Promise<SensorCapabilities>;
  getPermissionStatus(): Promise<PermissionResult>;
  requestPermissions(): Promise<PermissionResult>;
  /** One permission. Host must explain that permission in the app first. */
  requestPermission(kind: keyof PermissionResult): Promise<PermissionResult>;
  /** Background / Always location. Host must show a prominent disclosure first. */
  requestBackgroundLocation(): Promise<PermissionResult>;
  start(options: NativeStartOptions): Promise<void>;
  /** Foreground GPS+IMU readout. Not a trip — no FGS / journal / running. */
  startPreview(options: NativeStartOptions): Promise<void>;
  stopPreview(): Promise<void>;
  /** `handoffToWatch` keeps the Android location FGS up so auto re-arm does not call `startForegroundService` from the background. */
  stop(options?: { handoffToWatch?: boolean }): Promise<NativeRawSession>;
  getSnapshot(): Promise<NativeRawSession>;
  isRunning(): Promise<boolean>;
  /** Update the Android trip notification (and iOS Live Activity host bridge). */
  updateTripLiveDisplay(payload: TripLiveDisplayPayload): Promise<void>;
  clearTripLiveDisplay(): Promise<void>;
  /** Sparse OS watch — must not start trip FGS or IMU journal. */
  armWatch(): Promise<void>;
  disarmWatch(): Promise<void>;
};

export type TripLiveDisplayPayload = {
  title: string;
  score: string;
  speed: string;
  duration: string;
  distance: string;
};
