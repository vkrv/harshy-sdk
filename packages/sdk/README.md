# @harshy/sdk

Plug-and-play JavaScript client for **Harshy** — on-device driving quality analysis. Hosts start a trip, subscribe to live GPS/IMU, metrics, and events, and receive a versioned `SessionExport` on stop. The npm package is `@harshy/sdk`; the factory is `createHarshy()`.

Detection (harsh events, speeding, jerk, road RMS, possible impact, phone handheld) runs in `@harshy/core` inside this client. Do not reimplement detector math in the host app.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Permissions](#permissions)
- [Starting and Stopping Trips](#starting-and-stopping-trips)
- [Automatic trips (preview)](#automatic-trips-preview)
- [Subscribing to Live Data](#subscribing-to-live-data)
- [Event Helpers](#event-helpers)
- [Detector Configuration](#detector-configuration)
- [Local History](#local-history)
- [Upload Adapter](#upload-adapter)
- [Headless / Custom Sensors](#headless--custom-sensors)
- [Native Android / iOS](#native-android--ios)
- [Common Pitfalls](#common-pitfalls)
- [API Reference](#api-reference)

## Installation

Packages are not published to npm yet. Add this repository to the **host pnpm workspace** (clone, submodule, or sibling path). See the [root README](../../README.md#use-in-another-project).

```yaml
# pnpm-workspace.yaml (host)
packages:
  - "."
  - "../harshy-sdk/packages/*"
```

```bash
pnpm add @harshy/sdk @harshy/native
```

Add the Expo config plugin (required for permissions and Android foreground service):

```json
{
  "expo": {
    "plugins": ["@harshy/native"]
  }
}
```

**Important:** You must depend on **both** `@harshy/sdk` (JS client) and `@harshy/native` (native sensors) so Expo autolinking sees the module. The native package is required for GPS and IMU capture on iOS/Android.

## Quick Start

```ts
import {
  createHarshy,
  impactDirectionLabel,
  isPossibleImpact,
  isPhoneHandheld,
  type DrivingEvent,
  type LiveMetrics,
} from "@harshy/sdk";
import { createNativeEngine, isNativeEngineAvailable } from "@harshy/sdk/native";

// Create a client with native sensor support
const harshy = createHarshy({
  nativeAvailable: isNativeEngineAvailable(),
  createNativeEngine,
});

// Subscribe to live metrics and events
harshy.subscribe({
  onMetrics: (metrics: LiveMetrics) => {
    console.log("Score:", metrics.score);
    console.log("Speed:", metrics.speedMps, "m/s");
    console.log("Distance:", metrics.distanceM, "m");
  },
  onEvent: (event: DrivingEvent) => {
    console.log("Event:", event.type, event.level);
  },
});

// Request permissions (shows system dialogs)
const permissions = await harshy.requestPermissions();

// Start recording a trip
if (permissions.location === "granted") {
  await harshy.start({ source: "native" });
}

// ... drive ...

// Stop and get the session export
const session = await harshy.stop();
console.log("Trip score:", session.metrics.score);
console.log("Events:", session.events.length);
```

## Permissions

Call `requestPermissions()` before starting a trip. It waits for the user to respond to system dialogs and returns the resulting permission status.

```ts
const status = await harshy.requestPermissions();
// status: { location, backgroundLocation, motion, notifications }
```

| Permission | iOS | Android |
|------------|-----|---------|
| `location` | When In Use → Always | Fine/Coarse location |
| `backgroundLocation` | Always (second prompt) | Background location |
| `motion` | Motion & Fitness | Not required |
| `notifications` | Not required | Android 13+ notification |

**Rules:**

- `requestPermissions()` only prompts; it does not start GPS or IMU
- `start()` throws if `location` is not `"granted"`
- Background recording requires `backgroundLocation: "granted"` (enabled by default with `background: true`)

```ts
import { isLocationGranted, permissionLabel } from "@harshy/sdk";

const status = await harshy.requestPermissions();

if (!isLocationGranted(status)) {
  console.log("Location:", permissionLabel(status.location)); // "Denied" | "Granted" | "Not determined"
  return;
}

await harshy.start();
```

## Starting and Stopping Trips

### Start Options

```ts
await harshy.start({
  // Sensor source: "native" | "simulated" | "auto" (default: auto)
  source: "native",

  // Detector thresholds for this trip
  detector: {
    harshAccelMps2: 4,
    harshBrakeMps2: 4,
    harshCornerMps2: 3.5,
  },

  // Native sensor options
  native: {
    imuHz: 50,           // IMU sample rate (default: 50)
    background: true,    // Continue in background (default: true)
  },

  // Device info (auto-detected if omitted)
  device: {
    platform: "ios",
    model: "iPhone 15",
  },
});
```

The `source` option:
- `"native"`: Use device GPS + IMU (requires `@harshy/native`)
- `"simulated"`: Play a synthetic trip (useful for testing)
- `"auto"`: Native on iOS/Android, simulated elsewhere (default)

### Stopping a Trip

```ts
const session = await harshy.stop();

// session.sessionId: unique trip ID
// session.metrics: { score, distanceM, durationMs, maxSpeedMps, ... }
// session.events: DrivingEvent[]
// session.location: LocationSample[]
// session.imu: ImuSample[]
// session.config: DetectorConfig used
```

`stop()` finalizes the trip, re-runs analysis on recorded samples, and returns a `SessionExport`.

### Recovering from Process Death (Android)

On Android, in-progress trips are journaled to disk. If the app process dies, use `recover()` to attach to a live trip:

```ts
const client = createHarshy({ nativeAvailable, createNativeEngine });

// On app launch, check for a surviving trip
const recovered = await client.recover();
if (recovered) {
  console.log("Resumed trip:", client.getState().sessionId);
}
```

Call `recover()` before `arm()` so a live trip wins over watch restore. Recovered sessions keep journaled `trigger` (`auto` vs `manual`; older journals without it are `manual`).

## Automatic trips

Native MotionWatch + JS heuristic — **not fully calibrated**. Full write-up: [Automatic trips](../../docs/features/auto-trip.md).

The SDK default remains **manual**. Existing `start` / `stop` / `recover` callers do not change. Auto is opt-in:

```ts
harshy.subscribe({
  onWatchState: (watch) => {
    // watch.phase: "disarmed" | "armed" | "warmup" | "recording"
    // watch.trigger: "manual" | "auto" | null
    // watch.lastFix / startHoldMs / startDistanceM while armed
  },
});

await harshy.requestPermissions();
await harshy.arm(); // mode auto; sparse OS watch on native
await harshy.disarm();
```

| Rule | Detail |
|------|--------|
| Watch ≠ trip | `arm()` must not start GPS+IMU, the Android trip FGS, or the journal |
| Same pipeline | Auto calls existing `start({ trigger: "auto" })` / `stop()`; first phase is `warmup` |
| Warmup abort | 30 s parked (or silence) discards; not History; watch re-arms |
| Auto-stop trim | After commit, 10 min parked auto `stop()` ends the saved trip at the start of that dwell |
| Manual wins | `start()` while Auto is on records `trigger: "manual"` and suppresses auto until `stop()` |
| `source` vs `trigger` | `source` is native/simulated sensors; `trigger` is why the trip began |
| Session JSON | Optional `trigger` on `schemaVersion: 1`; older files parse as `"manual"` |
| Always required | Native `armWatch` throws without background / Always location; the client reverts to manual |

`createNativeEngine()` implements `armWatch` / `disarmWatch` / `subscribeWatch`. Simulated engines omit them (`nativeWatch: false`) and will not auto-start.

Call `recover()` before `arm()` so a live trip wins over watch restore.

## Subscribing to Live Data

Subscribe to real-time updates during a trip:

```ts
const unsubscribe = harshy.subscribe({
  // Aggregated metrics (score, speed, distance, etc.)
  onMetrics: (metrics: LiveMetrics) => {
    console.log(metrics.score);           // 0-100
    console.log(metrics.speedMps);        // current speed m/s
    console.log(metrics.distanceM);       // trip distance
    console.log(metrics.durationMs);      // trip duration
    console.log(metrics.accelLevel);      // "norm" | "light" | "medium" | "heavy"
    console.log(metrics.headingDeg);      // compass heading or null
  },

  // Driving events (harsh accel/brake/corner, speeding, etc.)
  onEvent: (event: DrivingEvent) => {
    console.log(event.type);    // "harsh_accel" | "harsh_brake" | ...
    console.log(event.level);   // "light" | "medium" | "heavy"
    console.log(event.t);       // timestamp ms
    console.log(event.peak);    // peak magnitude
  },

  // Raw GPS samples
  onLocation: (sample: LocationSample) => {
    console.log(sample.lat, sample.lon, sample.speedMps);
  },

  // Raw IMU samples
  onImu: (sample: ImuSample) => {
    console.log(sample.accel, sample.gyro, sample.gravity);
  },

  // Client state changes
  onState: (state: HarshyClientState) => {
    console.log(state.running, state.source, state.sessionId);
  },

  // Errors
  onError: (error: { code: string; message: string }) => {
    console.error(error.code, error.message);
  },
});

// Later: stop receiving updates
unsubscribe();
```

### Live Metrics

| Field | Type | Description |
|-------|------|-------------|
| `score` | `number` | Trip score 0-100 |
| `speedMps` | `number` | Current speed (m/s) |
| `distanceM` | `number` | Total distance (m) |
| `durationMs` | `number` | Trip duration (ms) |
| `maxSpeedMps` | `number` | Peak speed (m/s) |
| `accelLevel` | `HarshLevel` | Current accel severity |
| `brakeLevel` | `HarshLevel` | Current brake severity |
| `cornerLevel` | `HarshLevel` | Current corner severity |
| `swerveLevel` | `HarshLevel` | Current swerve severity |
| `headingDeg` | `number \| null` | Compass heading or null when stopped |

### Event Types

| Type | Description | Scoring |
|------|-------------|---------|
| `harsh_accel` | Hard acceleration | Yes |
| `harsh_brake` | Hard braking | Yes |
| `harsh_corner` | Sharp turn | Yes |
| `harsh_swerve` | Rapid lane change | Yes |
| `harsh_jerk` | GPS-weak fallback | Yes |
| `speeding` | Over speed limit (span with `endT`) | Yes |
| `possible_impact` | Crash-like jolt | No |
| `phone_handheld` | Phone picked up (span with `endT`) | No |

Events have a `level` of `"light"`, `"medium"`, or `"heavy"` based on magnitude vs thresholds.

## Event Helpers

Use helper functions to identify special event types:

```ts
import {
  isPossibleImpact,
  impactDirectionLabel,
  isPhoneHandheld,
} from "@harshy/sdk";

harshy.subscribe({
  onEvent: (event) => {
    // Possible impact: crash-like jolt (not a confirmed crash, not 911, no score penalty)
    if (isPossibleImpact(event)) {
      const direction = impactDirectionLabel(event.impactDirection);
      // direction: "Front" | "Rear" | "Rollover" | "Unknown"
      console.log("Possible impact:", direction);
      return;
    }

    // Phone handheld: phone picked up while moving (no score penalty)
    if (isPhoneHandheld(event)) {
      console.log("Phone picked up");
      return;
    }

    // Scored driving events
    console.log(event.type, event.level);
  },
});
```

**Important:** `possible_impact` and `phone_handheld` are informational. They do not affect the trip score and are not emergency calling. Handle them separately from scored events.

## Detector Configuration

Tune detection thresholds when creating the client or per trip:

### At Client Creation

```ts
const harshy = createHarshy({
  nativeAvailable,
  createNativeEngine,
  // Default detector config for all trips
  detector: {
    harshAccelMps2: 4,        // Harsh acceleration threshold (m/s²)
    harshBrakeMps2: 4,        // Harsh braking threshold (m/s²)
    harshCornerMps2: 3.5,     // Harsh cornering threshold (m/s²)
    minSpeedMps: 2.5,         // Ignore events below this speed
    impactPeakMps2: 35,       // Possible impact peak threshold
  },
  // Default native options
  native: {
    imuHz: 50,
    background: true,
  },
});
```

### Per Trip

```ts
await harshy.start({
  detector: { harshBrakeMps2: 5 },
  native: { imuHz: 100 },
});
```

### Live Tuning

Change thresholds during a trip:

```ts
harshy.setDetectorConfig({ harshAccelMps2: 3 });
const config = harshy.getDetectorConfig();
```

### Retune After Stop

Re-score recorded samples with different thresholds without driving again:

```ts
await harshy.start();
await harshy.stop();

// Stricter thresholds
const strict = harshy.retune({
  harshAccelMps2: 2,
  harshBrakeMps2: 2,
});
console.log("Strict score:", strict?.metrics.score);

// Looser thresholds
const loose = harshy.retune({
  harshAccelMps2: 6,
  harshBrakeMps2: 6,
});
console.log("Loose score:", loose?.metrics.score);
```

### Key Config Options

| Option | Default | Description |
|--------|---------|-------------|
| `harshAccelMps2` | 4 | Acceleration threshold (m/s²) |
| `harshBrakeMps2` | 4 | Braking threshold (m/s²) |
| `harshCornerMps2` | 3.5 | Cornering threshold (m/s²) |
| `harshSwerveRadps` | 0.5 | Swerve heading rate (rad/s) |
| `minSpeedMps` | 2.5 | Minimum speed for events (m/s) |
| `speedingMps` | null | Speed limit for speeding events |
| `impactPeakMps2` | 35 | Peak for possible impact (~3.5g) |
| `impactSpeedDeltaMps` | 4 | GPS speed change for impact |
| `handheldTiltDeg` | 35 | Tilt angle for phone handheld |

See `DetectorConfig` type for the full list.

## Local History

Persist trips locally so they survive app restarts:

```ts
import {
  createHarshy,
  createMemoryJsonFileStore,
  createPrefixedJsonFileStore,
  type JsonFileStore,
} from "@harshy/sdk";

// Option 1: In-memory store (tests, prototyping)
const memoryStore = createMemoryJsonFileStore();

// Option 2: AsyncStorage-backed store (production)
import AsyncStorage from "@react-native-async-storage/async-storage";

const asyncStore = createPrefixedJsonFileStore(
  {
    getItem: (key) => AsyncStorage.getItem(key),
    setItem: (key, value) => AsyncStorage.setItem(key, value),
    removeItem: (key) => AsyncStorage.removeItem(key),
  },
  "harshy_trips_"
);

// Create client with history store
const harshy = createHarshy({
  nativeAvailable,
  createNativeEngine,
  historyStore: asyncStore,
  maxHistory: 50, // Keep last 50 trips
});

// After a trip, history is updated automatically
await harshy.start();
await harshy.stop();

// Get in-memory history (already loaded from stop)
const cached = harshy.getHistory();

// Or load from store on a fresh client
const history = await harshy.loadHistory();
console.log("Past trips:", history.length);
```

**Notes:**

- History stores **compact** sessions (no IMU data) to save space
- `stop()` writes to the store automatically
- `retune()` updates the stored session in the background; call `flushHistory()` if you need to read immediately
- Persist failures throw from `stop()` and emit `onError` with code `"persist"`

### JsonFileStore Interface

Implement this interface for custom storage backends:

```ts
type JsonFileStore = {
  read: (name: string) => Promise<unknown | null>;
  write: (name: string, value: unknown) => Promise<void>;
  remove: (name: string) => Promise<void>;
  list: () => Promise<string[]>;
};
```

## Upload Adapter

Upload sessions to your server:

```ts
// Set adapter after client creation
harshy.setUploadAdapter({
  upload: async (session) => {
    await fetch("https://api.example.com/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(session),
    });
  },
});

// Upload after a trip
await harshy.start();
const session = await harshy.stop();
await harshy.upload(session);

// Or upload the last session
await harshy.upload();
```

**Notes:**

- Nothing is uploaded until you provide an adapter
- `upload()` validates the session with Zod before calling the adapter
- Missing adapter throws an error (no silent no-op)

## Headless / Custom Sensors

If you already have GPS and IMU data from another system (fleet telematics, custom sensors), use `analyzeTrip` directly:

```ts
import { analyzeTrip, parseSessionExport } from "@harshy/sdk";

const session = analyzeTrip({
  location: [
    { t: 0, lat: 32.0, lon: -117.0, speedMps: 0, courseDeg: 90, accuracyM: 5, ... },
    { t: 1000, lat: 32.001, lon: -117.0, speedMps: 10, courseDeg: 90, accuracyM: 5, ... },
    // ...
  ],
  imu: [
    { t: 0, accel: { x: 0, y: 0, z: 9.8 }, gyro: { x: 0, y: 0, z: 0 }, ... },
    // ...
  ],
  sessionId: "fleet-trip-123",
  startedAtMs: Date.now() - 60000,
  endedAtMs: Date.now(),
  device: { platform: "unknown", model: "Fleet Device" },
  config: { harshBrakeMps2: 5 }, // Optional overrides
});

// Validate against the Zod schema
const validated = parseSessionExport(session);
```

### Custom Sensor Engine

Implement `SensorEngine` for real-time analysis with custom sensors:

```ts
import { createHarshy, type SensorEngine } from "@harshy/sdk";

const customEngine: SensorEngine = {
  kind: "native",
  async getCapabilities() { /* ... */ },
  async getPermissionStatus() { /* ... */ },
  async requestPermissions() { /* ... */ },
  async start(options) { /* ... */ },
  async stop() { /* ... */ },
  async isRunning() { /* ... */ },
  async getSnapshot() { /* ... */ },
  subscribe(listeners) {
    // Call listeners.onLocation(sample) and listeners.onImu(sample)
    return () => { /* cleanup */ };
  },
};

const harshy = createHarshy({ engine: customEngine });
```

## Native Android / iOS

For native apps without React Native, use `HarshyClient` directly in Kotlin or Swift. Same session JSON, same detector rules.

See [`packages/native/README.md`](../native/README.md) and [Native SDK](../../docs/features/native-sdk.md).

**Important:** Do not run `HarshyClient` and the Expo module in the same process — both own the engine listener.

## Common Pitfalls

### Expo Go Does Not Work

The native GPS/IMU engine requires native code. Use a **development build** (`expo prebuild` + `expo run:ios/android`) or EAS Build. Expo Go cannot load `@harshy/native`.

```bash
# Development build
npx expo prebuild
npx expo run:ios   # or run:android

# Or use EAS
eas build --profile development --platform ios
```

### Missing Config Plugin

If you see permission errors or the Android foreground service doesn't start, ensure the config plugin is added:

```json
{
  "expo": {
    "plugins": ["@harshy/native"]
  }
}
```

Then rebuild the native app.

### Starting Without Permissions

`start()` throws if location permission is not granted. Always check permissions first:

```ts
const status = await harshy.requestPermissions();
if (status.location !== "granted") {
  // Show UI explaining why location is needed
  return;
}
await harshy.start();
```

### Background Recording

For trips to continue when the app is backgrounded:

1. `native: { background: true }` (default)
2. iOS: `UIBackgroundModes` → `location` (added by config plugin)
3. Android: Foreground service (added by config plugin)
4. `backgroundLocation: "granted"` permission

### GPS Validation

The SDK rejects implausible GPS fixes (teleports, coarse network-like fixes). If you see gaps in your trip:

- Ensure the device has clear sky view
- Check `accuracyM` on location samples
- Network-only fixes (no GPS) are filtered out

### Retune vs Retake

`retune()` re-scores existing samples with new thresholds. It does **not** re-record. For a fresh trip, call `stop()` then `start()` again.

### Duplicate trip storage

If the host already persists trips in its own format, do not also pass `historyStore` to `createHarshy`. Use one store or the other.

## API Reference

### `createHarshy(deps?)`

Create a client (`createHarshy`).

```ts
type CreateHarshyDeps = {
  engine?: SensorEngine;             // Custom sensor engine
  createNativeEngine?: () => SensorEngine;  // Factory for native engine
  nativeAvailable?: boolean;         // Is native engine available?
  detector?: Partial<DetectorConfig>;       // Default detector config
  native?: Partial<NativeStartOptions>;     // Default native options
  historyStore?: JsonFileStore;      // Persist trips locally
  maxHistory?: number;               // Max trips to keep (default: 100)
  liveDisplayTitle?: string;         // Notification title (default: Harshy)
  formatLiveDisplay?: (metrics, title) => TripLiveDisplayPayload;
};
```

### `HarshyClient`

| Method | Description |
|--------|-------------|
| `getState()` | Get current client state |
| `getCapabilities()` | Get sensor capabilities |
| `getPermissionStatus()` | Get current permission status |
| `requestPermissions()` | Show permission dialogs, return result |
| `start(options?)` | Start recording a trip |
| `startPreview(options?)` | Foreground GPS/IMU readout (not a trip) |
| `stopPreview()` | Stop that readout; does not stop a running trip |
| `recover(options?)` | Attach to a surviving native trip |
| `getLiveLocation()` | GPS samples for the in-progress trip (empty when idle). `recover()` does not replay journal fixes on `onLocation` |
| `stop()` | Stop and return session export |
| `arm(options?)` | Opt in to Auto (preview watch; default client is manual) |
| `disarm()` | Leave Auto; does not stop a running trip |
| `getWatchState()` | `disarmed` / `armed` / `recording` plus `trigger`, `lastFix`, start hold/distance |
| `subscribe(listeners)` | Subscribe to live updates |
| `getDetectorConfig()` | Get current detector config |
| `setDetectorConfig(config)` | Update detector config |
| `getLastSession()` | Get the last recorded session |
| `getHistory()` | Get cached history (from memory) |
| `loadHistory()` | Load history from store |
| `flushHistory()` | Wait for pending history writes |
| `setUploadAdapter(adapter)` | Set upload handler |
| `upload(session?)` | Upload a session |
| `retune(config)` | Re-score with different thresholds |

### Types

Key types re-exported from `@harshy/core`:

- `SessionExport` — Complete trip data
- `DrivingEvent` — A detected event
- `DrivingEventType` — Event type enum
- `LiveMetrics` — Real-time aggregated metrics
- `LocationSample` — GPS fix
- `ImuSample` — IMU reading
- `DetectorConfig` — Detection thresholds
- `PermissionResult` — Permission status map
- `HarshLevel` — `"norm" | "light" | "medium" | "heavy"`
- `TripTrigger` — `"manual" | "auto"` (why the trip started)
- `WatchState` — Auto-trip watch (`arm` / `disarm`)

### Utility Functions

```ts
// Event type checks
isPossibleImpact(event: DrivingEvent): boolean
isPhoneHandheld(event: DrivingEvent): boolean
impactDirectionLabel(direction: string | null): string

// Permission helpers
isLocationGranted(status: PermissionResult): boolean
permissionLabel(status: PermissionStatus): string
grantedPermissions(): PermissionResult

// Scoring
scoreEvents(events: DrivingEvent[]): number
eventCounts(events: DrivingEvent[]): Record<DrivingEventType, number>

// Config
mergeDetectorConfig(partial?: Partial<DetectorConfig>): DetectorConfig
parseDetectorConfig(input: unknown): DetectorConfig

// Session
parseSessionExport(input: unknown): SessionExport
compactSessionExport(session: SessionExport): SessionExport

// Trip analysis
analyzeTrip(input: { location, imu, sessionId, startedAtMs, endedAtMs, device, config? }): SessionExport
createTripAnalyzer(config, options): TripAnalyzer

// Live display formatting
formatTripDurationMs(ms: number): string
formatTripLiveDisplay(metrics: LiveMetrics, title: string): TripLiveDisplayPayload

// History store factories
createMemoryJsonFileStore(initial?): JsonFileStore
createPrefixedJsonFileStore(kv: JsonKeyValue, prefix: string): JsonFileStore
```

## Related documentation

- [Native Android / iOS](../native/README.md) — `HarshyClient` (Kotlin/Swift)
- [Driving SDK](../../docs/features/driving-sdk.md) — SDK behavior
- [Automatic trips](../../docs/features/auto-trip.md) — MotionWatch + `arm` / `disarm` (not fully calibrated)
- [Session export](../../docs/features/session-export.md) — Export schema and upload
- [Possible impact](../../docs/features/possible-impact.md) — Crash-like jolt detection
- [Phone handheld](../../docs/features/phone-handheld.md) — Phone pickup detection
- [Road quality](../../docs/features/road-quality.md) — Pavement roughness measure
