# Harshy SDK

On-device driving quality analysis for Android and iOS. Phone-only sensing — no external hardware.

This repository is the **host SDK**. Add it to any Expo / React Native, Android, or iOS project. Detection (harsh events, speeding, jerk, road RMS, possible impact, phone handheld) runs in `@harshy/core` and the native ports. Do not reimplement detector math in the host.

Published npm names stay `@harshy/*`. The JavaScript factory is `createHarshy()`. Native apps use `HarshyClient` (Kotlin / Swift).

## Packages

| Package | Use |
|---------|-----|
| [`@harshy/sdk`](packages/sdk) | JavaScript / Expo / React Native client |
| [`@harshy/native`](packages/native) | GPS/IMU engines, Expo module, Kotlin/Swift `HarshyClient` |
| [`@harshy/core`](packages/core) | Detector, scoring, session schema (pure TypeScript) |
| `@harshy/config` | Shared ESLint + TypeScript bases (this repo only) |

## Use in another project

Clone or submodule this repo next to the host (or vendor it inside the host). The packages are not published to npm yet; consume them as a **pnpm workspace**.

### 1. Include the packages in the host workspace

```yaml
# pnpm-workspace.yaml (host)
packages:
  - "apps/*"
  - "packages/*"
  - "../harshy-sdk/packages/*"   # or vendor/harshy-sdk/packages/*
```

```bash
pnpm add @harshy/sdk @harshy/native --filter your-app
```

`@harshy/core` is pulled in transitively. Expo hosts must depend on **both** `@harshy/sdk` and `@harshy/native` so autolinking sees the native module.

### 2. Expo / React Native

Add the config plugin (permissions + Android foreground service):

```json
{
  "expo": {
    "plugins": ["@harshy/native"]
  }
}
```

```ts
import { createHarshy } from "@harshy/sdk";
import { createNativeEngine, isNativeEngineAvailable } from "@harshy/sdk/native";

const harshy = createHarshy({
  nativeAvailable: isNativeEngineAvailable(),
  createNativeEngine,
  liveDisplayTitle: "Your App", // Android trip notification title
});

harshy.subscribe({
  onMetrics: (metrics) => {
    console.log(metrics.score, metrics.speedMps);
  },
  onEvent: (event) => {
    console.log(event.type, event.level);
  },
});

const permissions = await harshy.requestPermissions();
if (permissions.location === "granted") {
  await harshy.start({ source: "native" });
}

const session = await harshy.stop();
```

**Expo Go cannot load the native engine.** Use a development build (`expo prebuild` + `expo run:ios` / `run:android`) or EAS Build.

Full JavaScript API: [`packages/sdk/README.md`](packages/sdk/README.md).

### 3. Native Android

Include the host library (engine + client, no Expo):

```gradle
// settings.gradle
include ':harshy'
project(':harshy').projectDir = new File(settingsDir, '../harshy-sdk/packages/native/android-host')
```

```gradle
// app/build.gradle
dependencies {
  implementation project(':harshy')
}
```

Copy-paste and permissions: [`packages/native/README.md`](packages/native/README.md).

### 4. Native iOS

Xcode → Add Package Dependency → Add Local → `packages/native` (the Swift package excludes the Expo module).

Info.plist:

- `NSLocationWhenInUseUsageDescription`
- `NSLocationAlwaysAndWhenInUseUsageDescription`
- `NSMotionUsageDescription`
- `UIBackgroundModes` → `location`

### 5. Headless (you already have GPS/IMU)

```ts
import { analyzeTrip, parseSessionExport } from "@harshy/sdk";

const session = analyzeTrip({
  location,
  imu,
  sessionId: "fleet-trip-123",
  startedAtMs,
  endedAtMs,
  device: { platform: "unknown", model: "Fleet Device" },
});
parseSessionExport(session);
```

Kotlin `analyzeTrip` and Swift `harshyAnalyzeTrip` are equivalent.

## What the SDK does

- Local GPS + IMU capture on Android and iOS
- On-device events: harsh accel / brake / corner / swerve, optional speeding spans, IMU jerk fallback, compound overlap tags, possible-impact heuristic, phone-handheld while moving
- Session export with samples, events, and scores (`schemaVersion: 1`)
- Optional local history (`historyStore`) and host-owned `UploadAdapter` (nothing is uploaded until you set one)
- Optional automatic trips (`arm` / `disarm`) — preview, not fully calibrated

GPS+IMU for a trip start only on `start()` and end on `stop()`. `requestPermissions()` only shows system dialogs. `startPreview` / `stopPreview` are a foreground readout that is **not** a trip (no journal, no foreground service).

Do not construct `HarshyClient` in the same process as the Expo module — both own the engine listener.

## Documentation

| Doc | Description |
|-----|-------------|
| [docs/INDEX.md](docs/INDEX.md) | Doc registry |
| [packages/sdk/README.md](packages/sdk/README.md) | JavaScript host API |
| [packages/native/README.md](packages/native/README.md) | Kotlin / Swift `HarshyClient` + Expo bridge |
| [docs/features/driving-sdk.md](docs/features/driving-sdk.md) | SDK behavior |
| [docs/features/native-sdk.md](docs/features/native-sdk.md) | Native host SDK |
| [docs/architecture/sensors.md](docs/architecture/sensors.md) | GPS/IMU and permissions |
| [docs/features/session-export.md](docs/features/session-export.md) | Session JSON and upload |
| [docs/features/auto-trip.md](docs/features/auto-trip.md) | Automatic trips (not fully calibrated) |

## Develop this repo

Requires **Node 24**, **pnpm 11**, JDK 17+, and the Android SDK for native JUnit.

```bash
pnpm install
pnpm check    # build + typecheck + lint + test
pnpm test     # Vitest + Android JUnit (+ Swift HarshyMath on macOS)
```

## License

MIT. See [LICENSE](LICENSE).
