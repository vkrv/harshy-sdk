# Testing

## Stack

- **Vitest** for `@harshy/core` and `@harshy/sdk`
- **Native Android (JUnit):** `packages/native/android/src/test` via `android-unit` Gradle runner (`pnpm --filter @harshy/native test` / `test:android`). Covers detector parity, sample maps, harsh bands / GPS reject, RoadStamp, TripIdleGate, `assessRoad`, watch-fix maps, trip-live payload copy, journal `trigger` meta, LocationFallback, and LocationFeeds.
- **Native iOS (Swift PM):** `HarshyMath` package on macOS (`test:ios`) — Foundation-only Swift (analyzer, heading, road, idle gate, sample maps, watch activity, RoadStamp). `HarshyHeadlessTripRecorder` is in the package too: it takes its motion through the `HarshyMotionSource` protocol, so its lifecycle, stamping and failure handling run against a fake source. Only `HarshyCoreMotionSource` (the real Core Motion adapter) and the full `Harshy` client (CoreLocation / CoreMotion / UIKit) stay iOS-only SPM / CocoaPods. The package's sources and tests are symlinks into `ios/` and `Tests/`: a new Foundation-only Swift file is only compiled and tested here once you add a symlink for it under `HarshyMath/Sources/HarshyMath` (and one for its test under `HarshyMath/Tests/HarshyMathTests`).

## Quality gate

```bash
pnpm test    # package tests via turbo (includes native Android JUnit; Swift on macOS)
pnpm check   # build + typecheck + lint + test
```

CI (`.github/workflows/ci.yml`) runs install → build → typecheck → lint → test on Ubuntu (with JDK 17 + Android SDK). A separate `native-ios` macOS job runs `swift test` for HarshyMath, then builds the full `Harshy` package for the iOS Simulator (`xcodebuild`) so the UIKit-dependent engine and client are compiled. That step checks compilation only; the engine and client have no unit tests yet. The macOS job pins its runner (`macos-26`) and Xcode (`DEVELOPER_DIR`) so it does not change when `macos-latest` or the image's default Xcode moves; bump both together in the workflow.

## Manual device check (iOS recorder)

`HarshyCoreMotionSource` and the background behaviour cannot run under `swift test`. Before a release that touches them, on a real iPhone with a host that has `UIBackgroundModes: location`:

1. Start a recorder, drive or walk for a few minutes, and check `didStartAt` reports all four sensors.
2. Lock the phone and background the app for a minute. Check IMU samples keep arriving (the exported `imu` count grows at about `capture.imuHz`).
3. Stop. Check `didFinalize` fires once, the session has `capture` with the clamped `imuHz` and `locationIntervalMs`, and `device.model` is a hardware identifier such as `iPhone17,3`.
4. Check no Motion & Fitness prompt appeared.

## What to test

- Detector events, harsh bands, smooth accel/brake/corner credits (`smooth_corner` needs same-sign lateral + ≥15° net track heading), speeding spans, swerve, compound overlaps, live heading filter, displacement `derivedCourseDeg` (display heading only; stored `courseDeg` stays OS/null), track-vs-chip yaw (`confirmedYawDetail` / `pathOnly`; chip↔path agreement without gyro stays path-only; path-only harsh corners need accuracy ≤15 m, lateral ≤6 m/s², and 1 s / 8 m / ≥20° hold), GPS long/lat accel window, same-type coalesce, road-quality RMS, possible-impact pulses, phone-handheld spans, GPS teleport / coarse-fix rejection, live sample caps + idle motion gate, auto-trip start/end heuristics, optional session `trigger` defaulting to `manual`, and re-scoring when thresholds change (`packages/core`)
- SDK session export, retune, upload adapter, attach/`recover`, `getLiveLocation()`, `getLiveEvents()`, optional `historyStore`, indexed JSON archive, auto-trip `arm` / `disarm` / watch-state machine, `startPreview` (not a trip), and the host barrel (`packages/sdk`)
- Compact session JSON (`compactSessionExport`) keeps `accuracyM` and still parses with Zod (`packages/core`)
- Native Android JUnit and HarshyMath Swift parity (`packages/native`)
- Regression tests for bug fixes when practical

Update this doc when the testing strategy changes.
