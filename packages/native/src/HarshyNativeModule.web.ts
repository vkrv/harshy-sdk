import { NativeModule, registerWebModule } from "expo";

import type {
  HarshyNativeModuleApi,
  HarshyNativeModuleEvents,
  NativeRawSession,
} from "./HarshyNative.types";

class HarshyNativeModule
  extends NativeModule<HarshyNativeModuleEvents>
  implements HarshyNativeModuleApi
{
  async getCapabilities() {
    return {
      location: false,
      accelerometer: false,
      linearAcceleration: false,
      gyroscope: false,
      magnetometer: false,
      barometer: false,
      attitude: false,
      backgroundLocation: false,
    };
  }

  async getPermissionStatus() {
    return {
      location: "undetermined" as const,
      backgroundLocation: "undetermined" as const,
      motion: "undetermined" as const,
      notifications: "undetermined" as const,
    };
  }

  async requestPermissions() {
    return this.getPermissionStatus();
  }

  async start(): Promise<void> {
    throw new Error("Native Harshy engine is not available on web. Use source: \"simulated\".");
  }

  async startPreview(): Promise<void> {
    throw new Error("Native Harshy engine is not available on web. Use source: \"simulated\".");
  }

  async stopPreview(): Promise<void> {}

  async stop(): Promise<NativeRawSession> {
    throw new Error("Native Harshy engine is not available on web.");
  }

  async getSnapshot(): Promise<NativeRawSession> {
    throw new Error("Native Harshy engine is not available on web.");
  }

  async isRunning(): Promise<boolean> {
    return false;
  }

  async updateTripLiveDisplay(): Promise<void> {}

  async clearTripLiveDisplay(): Promise<void> {}

  async armWatch(): Promise<void> {
    throw new Error("Native Harshy engine is not available on web.");
  }

  async disarmWatch(): Promise<void> {}
}

export default registerWebModule(HarshyNativeModule, "HarshyNativeModule");
