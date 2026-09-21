# Testing

## Stack

- **Vitest** for `@harshy/core` and `@harshy/sdk`
- **Native Android (JUnit):** `packages/native/android/src/test` via `android-unit` Gradle runner (`pnpm --filter @harshy/native test` / `test:android`). Covers detector parity, sample maps, harsh bands / GPS reject, RoadStamp, TripIdleGate, `assessRoad`, watch-fix maps, trip-live payload copy, journal `trigger` meta.
- **Native iOS (Swift PM):** `HarshyMath` package on macOS (`test:ios`) — Foundation-only Swift (analyzer, heading, road, idle gate, sample maps, watch activity, RoadStamp). Full `Harshy` client (CoreLocation / CoreMotion) stays iOS-only SPM / CocoaPods.

## Quality gate

```bash
pnpm test    # package tests via turbo (includes native Android JUnit; Swift on macOS)
pnpm check   # build + typecheck + lint + test
```

CI (`.github/workflows/ci.yml`) runs install → build → typecheck → lint → test on Ubuntu (with JDK 17 + Android SDK). A separate `native-ios` macOS job runs `swift test` for HarshyMath.

## What to test

- Detector events, harsh bands, speeding spans, swerve, compound overlaps, live heading filter, displacement `derivedCourseDeg`, GPS long/lat accel window, same-type coalesce, road-quality RMS, possible-impact pulses, phone-handheld spans, GPS teleport / coarse-fix rejection, live sample caps + idle motion gate, auto-trip start/end heuristics, optional session `trigger` defaulting to `manual`, and re-scoring when thresholds change (`packages/core`)
- SDK session export, retune, upload adapter, attach/`recover`, `getLiveLocation()`, optional `historyStore`, indexed JSON archive, auto-trip `arm` / `disarm` / watch-state machine, `startPreview` (not a trip), and the host barrel (`packages/sdk`)
- Compact session JSON (`compactSessionExport`) keeps `accuracyM` and still parses with Zod (`packages/core`)
- Native Android JUnit and HarshyMath Swift parity (`packages/native`)
- Regression tests for bug fixes when practical

Update this doc when the testing strategy changes.
