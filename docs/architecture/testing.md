# Testing

## Stack

- **Vitest** for `@harshy/core` and `@harshy/sdk`
- **Native Android (JUnit):** `packages/native/android/src/test` via `android-unit` Gradle runner (`pnpm --filter @harshy/native test` / `test:android`). Covers detector parity, sample maps, harsh bands / GPS reject, RoadStamp, TripIdleGate, `assessRoad`, watch-fix maps, trip-live payload copy, journal `trigger` meta, LocationFallback, and LocationFeeds.
- **Native iOS (Swift PM):** `HarshyMath` package on macOS (`test:ios`) — Foundation-only Swift (analyzer, heading, road, idle gate, sample maps, watch activity, RoadStamp). Full `Harshy` client (CoreLocation / CoreMotion) stays iOS-only SPM / CocoaPods.

## Quality gate

```bash
pnpm test    # package tests via turbo (includes native Android JUnit; Swift on macOS)
pnpm check   # build + typecheck + lint + test
```

CI (`.github/workflows/ci.yml`) runs install → build → typecheck → lint → test on Ubuntu (with JDK 17 + Android SDK). A separate `native-ios` macOS job runs `swift test` for HarshyMath.

## What to test

- Detector events, harsh bands, smooth accel/brake/corner credits (`smooth_corner` needs same-sign lateral + ≥15° net track heading), speeding spans, swerve, compound overlaps, live heading filter, displacement `derivedCourseDeg` (display heading only; stored `courseDeg` stays OS/null), track-vs-chip yaw (`confirmedYawDetail` / `pathOnly`; path-only harsh corners need accuracy ≤15 m, lateral ≤6 m/s², and 1 s / 8 m / ≥20° hold), GPS long/lat accel window, same-type coalesce, road-quality RMS, possible-impact pulses, phone-handheld spans, GPS teleport / coarse-fix rejection, live sample caps + idle motion gate, auto-trip start/end heuristics, optional session `trigger` defaulting to `manual`, and re-scoring when thresholds change (`packages/core`)
- SDK session export, retune, upload adapter, attach/`recover`, `getLiveLocation()`, optional `historyStore`, indexed JSON archive, auto-trip `arm` / `disarm` / watch-state machine, `startPreview` (not a trip), and the host barrel (`packages/sdk`)
- Compact session JSON (`compactSessionExport`) keeps `accuracyM` and still parses with Zod (`packages/core`)
- Native Android JUnit and HarshyMath Swift parity (`packages/native`)
- Regression tests for bug fixes when practical

Update this doc when the testing strategy changes.
