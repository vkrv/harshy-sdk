import {
  generateSampleTrip,
  grantedPermissions,
  parseTripTrigger,
  playSimulatedTrip,
  type LocationSample,
  type NativeStartOptions,
} from "@harshy/core";

import type { SensorEngine } from "./types";

export function createSimulatedEngine(options?: {
  playbackSpeed?: number;
  immediate?: boolean;
}): SensorEngine {
  let stopPlayback: (() => void) | null = null;
  let previewTimer: ReturnType<typeof setInterval> | null = null;
  let location: LocationSample[] = [];
  let imu: ReturnType<typeof generateSampleTrip>["imu"] = [];
  let startedAtMs = 0;
  let sessionId: string | null = null;
  let running = false;
  let previewing = false;
  let tripTrigger: "manual" | "auto" = "manual";
  let locationHandler: ((sample: LocationSample) => void) | null = null;
  let imuHandler: ((sample: ReturnType<typeof generateSampleTrip>["imu"][number]) => void) | null = null;
  let errorHandler: ((error: { code: string; message: string }) => void) | null = null;

  const stopPreviewLocked = () => {
    if (previewTimer) {
      clearInterval(previewTimer);
      previewTimer = null;
    }
    previewing = false;
  };

  return {
    kind: "simulated",
    async getCapabilities() {
      return {
        location: true,
        accelerometer: true,
        linearAcceleration: true,
        gyroscope: true,
        magnetometer: true,
        barometer: true,
        attitude: true,
        backgroundLocation: false,
      };
    },
    async getPermissionStatus() {
      return grantedPermissions();
    },
    async requestPermissions() {
      return grantedPermissions();
    },
    async start(native: NativeStartOptions) {
      stopPreviewLocked();
      const trip = generateSampleTrip({
        startedAtMs: Date.now(),
        imuHz: native.imuHz,
      });
      location = [];
      imu = [];
      startedAtMs = trip.startedAtMs;
      sessionId = `sim-${trip.startedAtMs}`;
      tripTrigger = parseTripTrigger(native.trigger);
      running = true;
      stopPlayback?.();
      if (options?.immediate) {
        for (const sample of trip.location) {
          location.push(sample);
          locationHandler?.(sample);
        }
        for (const sample of trip.imu) {
          imu.push(sample);
          imuHandler?.(sample);
        }
        stopPlayback = null;
        return;
      }
      stopPlayback = playSimulatedTrip(
        { ...trip, sessionId },
        {
          onLocation: (sample) => {
            location.push(sample);
            locationHandler?.(sample);
          },
          onImu: (sample) => {
            imu.push(sample);
            imuHandler?.(sample);
          },
          onDone: () => {
            stopPlayback = null;
          },
        },
        { speed: options?.playbackSpeed ?? 1 },
      );
    },
    async startPreview() {
      if (running || previewing) {
        return;
      }
      previewing = true;
      let ticks = 0;
      const emit = () => {
        const t = Date.now();
        ticks += 1;
        imuHandler?.({
          t,
          accel: { x: 0, y: 0, z: 9.80665 },
          linearAccel: { x: 0, y: 0, z: 0 },
          gyro: { x: 0, y: 0, z: 0 },
          magnetometer: { x: 0, y: 20, z: 40 },
          attitude: { pitch: 0, roll: 0, yaw: 0 },
          gravity: { x: 0, y: 0, z: 9.80665 },
          barometerHpa: 1013.25,
        });
        if (ticks === 1 || ticks % 10 === 0) {
          locationHandler?.({
            t,
            lat: 0,
            lon: 0,
            altitudeM: 0,
            speedMps: 0,
            courseDeg: null,
            accuracyM: 12,
            altitudeAccuracyM: 16,
          });
        }
      };
      emit();
      previewTimer = setInterval(emit, 50);
    },
    async stopPreview() {
      if (running) {
        return;
      }
      stopPreviewLocked();
    },
    async stop() {
      stopPlayback?.();
      stopPlayback = null;
      stopPreviewLocked();
      running = false;
      return {
        sessionId,
        startedAtMs,
        endedAtMs: Date.now(),
        location: [...location],
        imu: [...imu],
        trigger: tripTrigger,
      };
    },
    async isRunning() {
      return running;
    },
    async getSnapshot() {
      return {
        sessionId,
        startedAtMs,
        endedAtMs: Date.now(),
        location: [...location],
        imu: [...imu],
        trigger: tripTrigger,
      };
    },
    subscribe(listeners) {
      locationHandler = listeners.onLocation;
      imuHandler = listeners.onImu;
      errorHandler = listeners.onError;
      return () => {
        if (locationHandler === listeners.onLocation) {
          locationHandler = null;
        }
        if (imuHandler === listeners.onImu) {
          imuHandler = null;
        }
        if (errorHandler === listeners.onError) {
          errorHandler = null;
        }
      };
    },
  };
}
