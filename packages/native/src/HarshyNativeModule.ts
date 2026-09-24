import { NativeModule, requireNativeModule } from "expo";

import type {
  HarshyNativeModuleApi,
  HarshyNativeModuleEvents,
} from "./HarshyNative.types";

declare class HarshyNativeModule
  extends NativeModule<HarshyNativeModuleEvents>
  implements HarshyNativeModuleApi
{
  getCapabilities: HarshyNativeModuleApi["getCapabilities"];
  getPermissionStatus: HarshyNativeModuleApi["getPermissionStatus"];
  requestPermissions: HarshyNativeModuleApi["requestPermissions"];
  requestPermission: HarshyNativeModuleApi["requestPermission"];
  requestBackgroundLocation: HarshyNativeModuleApi["requestBackgroundLocation"];
  start: HarshyNativeModuleApi["start"];
  startPreview: HarshyNativeModuleApi["startPreview"];
  stopPreview: HarshyNativeModuleApi["stopPreview"];
  stop: HarshyNativeModuleApi["stop"];
  getSnapshot: HarshyNativeModuleApi["getSnapshot"];
  isRunning: HarshyNativeModuleApi["isRunning"];
  updateTripLiveDisplay: HarshyNativeModuleApi["updateTripLiveDisplay"];
  clearTripLiveDisplay: HarshyNativeModuleApi["clearTripLiveDisplay"];
  armWatch: HarshyNativeModuleApi["armWatch"];
  disarmWatch: HarshyNativeModuleApi["disarmWatch"];
}

export default requireNativeModule<HarshyNativeModule>("HarshyNative");
