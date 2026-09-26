import { mergeNativeStartOptions, parseTripTrigger, type NativeStartOptions } from "@harshy/core";
import HarshyNative from "@harshy/native";
import { Platform } from "react-native";

import { parseImuList, parseImuSample, parseLocationList, parseLocationSample, parseWatchFix } from "./parse-samples";
import type { EngineSession, SensorEngine } from "./types";

export function isNativeEngineAvailable(): boolean {
  return Platform.OS === "ios" || Platform.OS === "android";
}

function hasNativePreview(): boolean {
  return typeof HarshyNative.startPreview === "function";
}

function toSession(raw: {
  sessionId: string | null;
  startedAtMs: number;
  endedAtMs: number;
  location: unknown[];
  imu: unknown[];
  trigger?: unknown;
}): EngineSession {
  return {
    sessionId: raw.sessionId,
    startedAtMs: raw.startedAtMs,
    endedAtMs: raw.endedAtMs,
    location: parseLocationList(raw.location),
    imu: parseImuList(raw.imu),
    trigger: parseTripTrigger(raw.trigger),
  };
}

export function createNativeEngine(): SensorEngine {
  return {
    kind: "native",
    async getCapabilities() {
      return HarshyNative.getCapabilities();
    },
    async getPermissionStatus() {
      return HarshyNative.getPermissionStatus();
    },
    async requestPermissions() {
      return HarshyNative.requestPermissions();
    },
    async requestPermission(kind) {
      return HarshyNative.requestPermission(kind);
    },
    async requestBackgroundLocation() {
      return HarshyNative.requestBackgroundLocation();
    },
    async start(options: NativeStartOptions) {
      await HarshyNative.start(mergeNativeStartOptions(options));
    },
    async startPreview(options: NativeStartOptions) {
      if (!hasNativePreview()) {
        return;
      }
      await HarshyNative.startPreview(mergeNativeStartOptions({ ...options, background: false }));
    },
    async stopPreview() {
      if (typeof HarshyNative.stopPreview !== "function") {
        return;
      }
      await HarshyNative.stopPreview();
    },
    async stop(options) {
      return toSession(await HarshyNative.stop(options ?? {}));
    },
    async isRunning() {
      return HarshyNative.isRunning();
    },
    async getSnapshot() {
      return toSession(await HarshyNative.getSnapshot());
    },
    async updateLiveDisplay(payload) {
      await HarshyNative.updateTripLiveDisplay(payload);
    },
    async clearLiveDisplay() {
      await HarshyNative.clearTripLiveDisplay();
    },
    subscribe(listeners) {
      const locationSub = HarshyNative.addListener("onLocation", (sample) => {
        const parsed = parseLocationSample(sample);
        if (parsed) {
          listeners.onLocation(parsed);
        }
      });
      const imuSub = HarshyNative.addListener("onImuBatch", (payload) => {
        for (const sample of payload.samples) {
          const parsed = parseImuSample(sample);
          if (parsed) {
            listeners.onImu(parsed);
          }
        }
      });
      const errorSub = HarshyNative.addListener("onError", (error) => {
        listeners.onError(error);
      });
      return () => {
        locationSub.remove();
        imuSub.remove();
        errorSub.remove();
      };
    },
    async armWatch() {
      await HarshyNative.armWatch();
    },
    async disarmWatch() {
      await HarshyNative.disarmWatch();
    },
    subscribeWatch(listeners) {
      const fixSub = HarshyNative.addListener("onWatchFix", (sample) => {
        const parsed = parseWatchFix(sample);
        if (parsed) {
          listeners.onFix(parsed);
        }
      });
      const errorSub = HarshyNative.addListener("onError", (error) => {
        listeners.onError?.(error);
      });
      const stateSub = HarshyNative.addListener("onState", (state) => {
        if (state.running) {
          listeners.onNativeRunning?.();
        }
      });
      return () => {
        fixSub.remove();
        errorSub.remove();
        stateSub.remove();
      };
    },
  };
}
