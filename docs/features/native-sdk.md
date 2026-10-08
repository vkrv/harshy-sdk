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
- Android headless hosts: `HeadlessTripRecorder` runs the detector on its own thread from the host's location stream and the IMU sensors, with no foreground service, journal or permissions of its own. Building blocks: `Location.toLocationSample`, `imuSampleOf`, `compactSessionExport`, `detectorConfigFromMap` and `nativeStartOptionsFromMap` for remote configuration.
- The Kotlin `TripAnalyzer` matches `@harshy/core` memory bounds: IMU ring of `MAX_IMU_MINUTES` at the IMU Hz, `MAX_LOCATION_SAMPLES`, and road RMS stamped as each GPS sample arrives. `maxImuSamples` (Kotlin and `@harshy/core`) shortens the IMU ring for hosts that do not export raw IMU. `HarshyEngine`'s live IMU buffer is 2 minutes on Android and iOS (`engineImuRamSamples`). The Android journal file keeps 1 hour (`engineImuJournalSamples`) and is not loaded back into that deque. iOS has no IMU journal.
- iOS parity gaps: the Swift analyzer has no memory caps or online road stamping, and Swift has no compact export, config-map parsing or headless recorder.
- `start()` default IMU is 50 Hz. `stop()` re-runs `analyzeTrip` on the recorded samples. `retune()` re-scores the last trip. `recover()` attaches to an Android journaled trip after process death and restores journaled `trigger`.
- Permissions: `requestPermissions` waits for foreground dialogs only (iOS when-in-use, then motion if still undetermined; Android fine/coarse, notifications, and activity recognition). `requestPermission(kind)` and `requestBackgroundLocation()` ask for one permission, including Always / `ACCESS_BACKGROUND_LOCATION`. Android needs the host to forward `onRequestPermissionsResult`. `start()` throws if location is denied.
- Do not construct `HarshyClient` in the same process as the Expo module — both own the engine listener. Expo/RN hosts keep JS `@harshy/core` via `createHarshy`. Expo/RN apps should not also include `android-host` or the Swift package (autolinking already compiles these sources).
- Possible impact is not a crash, not 911, and not a score. Direction is `front` / `rear` / `rollover` / `unknown`.
- Automatic trips: Expo / JS `arm` / `disarm` plus native `HarshyEngine` MotionWatch. Native `HarshyClient` stays start/stop/recover (no JS heuristic). See [auto-trip.md](auto-trip.md).

## Open questions

- Whether to publish Maven/SPM binaries (source Android module + Swift Package already exist)
