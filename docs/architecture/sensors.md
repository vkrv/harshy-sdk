# Sensors

**Related:** [driving-sdk.md](../features/driving-sdk.md), [auto-trip.md](../features/auto-trip.md), [monorepo.md](monorepo.md)

## What we collect

| Signal | Android | iOS | Use |
|--------|---------|-----|-----|
| GPS (lat/lon, speed, course, accuracy) | `LocationManager` **GPS first**, plus platform `FUSED_PROVIDER` (API 31+, high-accuracy `LocationRequest`, always registered — do not trust `getAllProviders` / `isProviderEnabled` for fused) and `NETWORK_PROVIDER`. Analyzer uses fused/network only when GPS is off, still searching, or silent >8 s. Searching GPS is not journaled when fused is registered. `getLastKnownLocation` older than 30 s is not seeded | `CLLocationManager` (already fused) | Speed, path, longitudinal/lateral accel, live heading |
| Accelerometer | `TYPE_ACCELEROMETER` | `CMDeviceMotion` | Raw accel including gravity |
| Linear acceleration | `TYPE_LINEAR_ACCELERATION` | userAcceleration | IMU magnitude / jerk fallback / road RMS / possible impact |
| Gravity | `TYPE_GRAVITY` | gravity | World-up axis for [road quality](../features/road-quality.md) and possible-impact vertical / rollover |
| Gyroscope | `TYPE_GYROSCOPE` | rotationRate | Rotation rate |
| Magnetometer | `TYPE_MAGNETIC_FIELD` | magneticField | Heading support |
| Attitude | `TYPE_ROTATION_VECTOR` | attitude | Pitch/roll/yaw |
| Barometer | `TYPE_PRESSURE` | `CMAltimeter` | Pressure / altitude aid |

Default IMU rate is **50 Hz**. Location interval default **500 ms**. Values are configurable via `NativeStartOptions` (IMU 5–100 Hz). Possible-impact detection still works at 25 Hz.

GPS `course` at rest is noise. Live `headingDeg` stays blank until speed is at least `minSpeedMps` with two agreeing fixes, then a circular EMA; it holds when you stop. When the OS omits bearing (typical Android fused / network), the analyzer fills `courseDeg` from the displacement heading. Live G-force is GPS long/lat accel over a 0.2–8 s window so sparse fused fixes still produce a vector. Swerve still uses raw (or filled) course. The detector owns heading; hosts should not debounce it.

Sensors are **idle until `start()`**, except the explicit **armed motion watch** below and an optional **foreground readout** (`startPreview` / `stopPreview`). `requestPermissions()` only shows OS dialogs. `stop()` unregisters GPS/IMU and ends background modes (trip FGS / Live Activity). `arm()` / `disarm()` must not start or keep full capture. Preview uses the same GPS+IMU hardware in the foreground without a trip — no journal, FGS, Live Activity, or session. `start()` while previewing upgrades to a trip without a second sensor pipeline.

## Motion watch (armed)

**Related:** [auto-trip.md](../features/auto-trip.md)

Automatic trips need a third lifecycle that is **not a trip**: `disarmed` | `armed` (watching) | `recording`. This is a scoped exception to “sensors idle until start”:

| Mode | Armed watch | Trip (`start()` … `stop()`) |
|------|-------------|------------------------------|
| APIs | Sparse OS motion / significant-location / activity (iOS: significant-change + ~25 m location, no trip background indicator; Android: sparse GPS + fused/network backup + significant-motion, no FGS) | Full GPS + IMU |
| Journal | None | Android `harshy-trip/` while the trip runs |
| FGS / Live Activity | **Must not run** | Start on trip start, end on stop |
| Sample rate | Duty-cycled OS callbacks | Default 50 Hz IMU, 500 ms GPS |

`requestPermissions()` still does not capture. Hosts opt in with `arm()`; default remains manual (`disarmed`). When a trip runs, the watch is down — full capture is only the existing start/stop pipeline. After `stop()`, if Auto is still selected, the client re-arms the watch only.

## Permissions

`PermissionResult` tracks four statuses (`granted` | `denied` | `undetermined`):

| Field | iOS | Android | Required to start |
|-------|-----|---------|-------------------|
| `location` | When-in-use or Always | Fine or coarse | **Yes** |
| `backgroundLocation` | Always | `ACCESS_BACKGROUND_LOCATION` (API 29+; same as location below 29) | No — requested for lock-screen GPS |
| `motion` | `CMMotionActivityManager` when available | `ACTIVITY_RECOGNITION` (API 29+; granted below 29) | No |
| `notifications` | Always `granted` | `POST_NOTIFICATIONS` (API 33+; granted below 33) | No — needed to show the trip FGS notice |

`requestPermissions()` **waits for the system dialog** before resolving:

1. iOS: when-in-use, then Always (once per install). Then a one-shot motion-activity query if that status is still not determined.
2. Android: fine + coarse (+ notifications on 13+, `ACTIVITY_RECOGNITION` on 10+), then background location as a **second** prompt (required on API 29+).

Do not return the pre-prompt status and start capture in the same turn. `start()` throws if `location` is not granted; it does not prompt.

The Expo config plugin `@harshy/native` merges usage strings, `UIBackgroundModes: location`, Android permissions (including `ACTIVITY_RECOGNITION`), `TripForegroundService`, and MainActivity `configChanges` (orientation, density, locale, grammatical gender, …) so rotation does not recreate the activity. Native iOS hosts set those Info.plist keys themselves; native Android hosts include `packages/native/android-host` so the manifest merges.

## Background

Full GPS+IMU collection continues after the app leaves the foreground **only while a trip is running**. An **armed motion watch** (auto-trip) is not a trip and must not start this FGS / Live Activity — see [Motion watch (armed)](#motion-watch-armed).

- **Android:** `TripForegroundService` (`location` type) starts on `start()` when `background: true` (default) and stops on `stop()`. `android:stopWithTask="false"` so swiping the task does not end the trip. The service is `START_STICKY` and calls `HarshyEngine.restoreIfNeeded(fromService = true)` so capture resumes after the OS kills the process without nesting another `startForegroundService`. Expo hosts resume the journal from `isRunning()` / `recover()` / `start()` — not from every `engine()` access (permission probes must not start the FGS). While the trip runs, the sticky notification shows live **score · speed · duration · distance** (~1 Hz via `TripLiveDisplay`) with a module drawable small icon and a null-safe channel. GPS (and IMU) are journaled under app files (`harshy-trip/`) while the trip is active; `meta.json` stores session `trigger` (`manual` | `auto`; missing is `manual`) so recover keeps auto vs tap-to-start; `stop()` deletes the journal. Journal + live rings match shared caps (`MAX_LOCATION_SAMPLES` = 20 000, IMU ≈ `imuHz × 60 × 120`). After the cap, rings **chunk-drop** (~2% slack) with O(1) `ArrayDeque` removes — never `removeAt(0)` per sample. Journal compaction is **amortized** (rewrite only past max + slack) via streamed temp+rename; recover loads a streaming tail and clears a corrupt/OOM sticky journal instead of crash-looping. While speed stays below `minSpeedMps` for ~2.5 s, **IMU is not journaled** and GPS is throttled to sparse breadcrumbs — trip UI/timer stay running (not a user-facing pause). Fine location is enough to run the FGS from a foreground tap; background location is requested so GPS can continue if the service is constrained. A partial wake lock is held for the trip. JS `createHarshy().recover()` reattaches the live UI to that native trip. Native Android `HarshyClient.recover()` does the same without JS.
- **iOS:** `allowsBackgroundLocationUpdates` and the blue indicator are enabled only with **Always** authorization plus `location` background mode. When-in-use still records in the foreground. Same idle IMU skip + sample caps in RAM with chunked ring trim (no on-disk journal). Hosts may start an ActivityKit Live Activity from the live-display payload. See [trip-live-display.md](../features/trip-live-display.md).

JS may pause on iOS with the screen off; native keeps a capped location ring. Expo `stop()` tears down native capture without bridging full IMU and **finalizes the live JS analyzer** (with GPS catch-up), instead of replaying hundreds of thousands of IMU samples across the bridge.
