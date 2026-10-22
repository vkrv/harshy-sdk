# Native Android / iOS host SDK

**Status:** shipped

## Summary

Kotlin and Swift apps integrate without React Native. `HarshyClient` starts GPS/IMU, streams live metrics and events, and returns the same `schemaVersion: 1` session JSON as `@harshy/sdk`. Detection runs on-device in a port of `@harshy/core` (canonical). Published AAR / XCFramework binaries are not part of this repo; this is source-in-repo (Android library module + Swift Package).

## Related

- Schema: [session-export.md](session-export.md)
- Native sensors: [../architecture/sensors.md](../architecture/sensors.md)
- JS host: [driving-sdk.md](driving-sdk.md), [`packages/sdk/README.md`](../../packages/sdk/README.md)
- Copy-paste: [`packages/native/README.md`](../../packages/native/README.md)
- Linked features: [possible-impact.md](possible-impact.md), [road-quality.md](road-quality.md), [auto-trip.md](auto-trip.md)

## Behavior

- Android: `com.harshy.sdk.HarshyClient` + `HarshyEngine` (journal + sticky location FGS). Include `packages/native/android-host` as a Gradle library (engine + client only; no Expo).
- iOS: `HarshyClient` + `HarshyEngine`. Add the Swift package at `packages/native` (excludes the Expo module).
- Android headless recording stamps samples with `HarshyClock.monotonic()`: epoch milliseconds that advance with the boot clock, so wall-clock corrections during a trip do not shift `t`. The engine behind `HarshyClient` still stamps with the wall clock.
- Headless hosts: `HeadlessTripRecorder` (Android) and `HarshyHeadlessTripRecorder` (iOS) run the detector on their own thread or queue from the host's location stream and the device's motion sensors, with no engine, foreground service, journal or permissions of their own. Android building blocks: `Location.toLocationSample`, `imuSampleOf`, `compactSessionExport`, `detectorConfigFromMap` and `nativeStartOptionsFromMap` for remote configuration. iOS: `CLLocation.harshyLocationSample(tMs:)`, `harshyImuSample`, `HarshyClock.monotonic()` and the Swift config and compact-export helpers below. The Kotlin and Swift `HarshyClient`s use the same analyzer as the headless recorders, so the ring caps and capture-rate defaults apply to both. Device `model` is `Build.MODEL` on Android and the hardware identifier (`HarshyDeviceInfo.current`, e.g. `iPhone17,3`) on iOS. **Since `sdkVersion` 13, iOS exports from `HarshyClient` report the identifier too, where earlier versions reported `iPhone` or `iPad`:** anything that groups by `device.model` sees new values. The iOS recorder reads Core Motion device motion (accel, linear accel, gyro and gravity) at `capture.imuHz` through a `HarshyMotionSource` (`HarshyCoreMotionSource` by default); it does not read the magnetometer, attitude or barometer, and it never asks for the Motion & Fitness permission. It stamps GPS from `location.timestamp` and IMU from the Core Motion timestamp, mapped onto the trip clock by the reading's age (`harshyCaptureMs`), so a batch of fixes keeps its own times. The host needs `UIBackgroundModes: location` and an active location session: Core Motion stops once the app is suspended.
- The Kotlin `TripAnalyzer` matches `@harshy/core` memory bounds: IMU ring of `MAX_IMU_MINUTES` at the IMU Hz, `MAX_LOCATION_SAMPLES`, and road RMS stamped as each GPS sample arrives. `maxImuSamples` (Kotlin and `@harshy/core`) shortens the IMU ring for hosts that do not export raw IMU. `HarshyEngine`'s live IMU buffer is 2 minutes on Android and iOS (`engineImuRamSamples`). The Android journal file keeps 1 hour (`engineImuJournalSamples`) and is not loaded back into that deque. iOS has no IMU journal.
- Swift has `harshyCompactSessionExport`, `harshyDetectorConfig(fromMap:base:)` and `harshyNativeStartOptions(fromMap:base:)`, which match the Kotlin and `@harshy/core` behavior.
- iOS parity gaps, still open:
  - `HarshyEngine` processes only the last fix of a batch in `didUpdateLocations` (Android handles every fix), and stamps samples with the wall clock at the callback rather than `location.timestamp`.
  - `HarshyClient` re-attaches (`recover()`, or `start()` onto a running engine) without the trip's `capture` options, so a recovered session export has no `capture` block. Android restores it with `captureFromSnapshot`.
- `start()` default IMU is 50 Hz. `stop()` re-runs `analyzeTrip` on the recorded samples. `retune()` re-scores the last trip. `recover()` attaches to an Android journaled trip after process death and restores journaled `trigger`.
- Permissions: `requestPermissions` waits for foreground dialogs only (iOS when-in-use, then motion if still undetermined; Android fine/coarse, notifications, and activity recognition). `requestPermission(kind)` and `requestBackgroundLocation()` ask for one permission, including Always / `ACCESS_BACKGROUND_LOCATION`. Android needs the host to forward `onRequestPermissionsResult`. `start()` throws if location is denied.
- Do not construct `HarshyClient` in the same process as the Expo module — both own the engine listener. Expo/RN hosts keep JS `@harshy/core` via `createHarshy`. Expo/RN apps should not also include `android-host` or the Swift package (autolinking already compiles these sources).
- Possible impact is not a crash, not 911, and not a score. Direction is `front` / `rear` / `rollover` / `unknown`.
- Automatic trips: Expo / JS `arm` / `disarm` plus native `HarshyEngine` MotionWatch. Native `HarshyClient` stays start/stop/recover (no JS heuristic). See [auto-trip.md](auto-trip.md).

## Open questions

- Whether to publish Maven/SPM binaries (source Android module + Swift Package already exist)
