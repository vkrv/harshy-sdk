# Automatic trips

**Status:** in-progress (native MotionWatch + journal `trigger` — not fully calibrated)

## Summary

The SDK records trips **manually or automatically**. The SDK default stays **manual** so existing hosts keep today’s contract. Auto is opt-in: the host calls `arm()`. Armed mode is a **watch**, not a trip — sparse OS motion / significant-location / activity only. When the v1 heuristic fires, the client reuses existing `start()` / `stop()` / `recover()` and the same `SessionExport` / `UploadAdapter` path. Full GPS+IMU, the Android trip FGS, and an iOS Live Activity still begin on trip start and end on stop.

## Related

- Schema: optional `SessionExport.trigger` (`manual` | `auto`) in `@harshy/core` — `schemaVersion` stays **1**; older JSON parses as `manual`
- API: `@harshy/sdk` `arm` / `disarm` / `getWatchState` / `onWatchState`; core `shouldStartTrip` / `shouldEndTrip`
- Native: Expo `armWatch` / `disarmWatch` / `onWatchFix`. Kotlin/Swift `HarshyEngine` owns the watch; `HarshyClient` stays start/stop/recover (no JS heuristic)
- Sensors: [../architecture/sensors.md](../architecture/sensors.md) (watch exception)
- Linked features: [driving-sdk.md](driving-sdk.md), [session-export.md](session-export.md), [native-sdk.md](native-sdk.md)

## Goals

- Support **manual and automatic** recording without forking a second capture pipeline
- Keep hosts that never call `arm()` on today’s behavior (`requestPermissions` does not capture; `start`/`stop` own GPS+IMU+FGS)
- Make Auto an explicit **armed / watching** state that is not a trip and does not write the trip journal
- SDK: manual `start()` / `stop()` always work; if Auto is selected, a manual `start()` **suppresses** auto until Stop
- Persist `trigger` on new sessions so hosts / upload can tell auto from tap-to-start

## Non-goals (v1)

- External hardware (Tag, OBD, BLE beacon) — permanent non-goal
- Hard transport class (car vs walk/bike) — v1 *soft*-filters OS cycling vs kinematics; walking / running at vehicle speed is ignored (step detector / pocket motion). Unknown activity still uses speed/distance. Android uses step-detector walking as a kinematics aid (no Play Services Activity Recognition)
- Driver vs passenger, map-match, crash verification
- A second IMU/GPS journal or a watch-mode FGS / Live Activity
- Changing `UploadAdapter` or compact-archive layout beyond optional `trigger`
- Native `HarshyClient` auto-start state machine (Expo / `createHarshy` owns the heuristic)

## States

```
disarmed  ──arm()──►  armed (watching)  ──probe──►  warmup  ──commit──►  recording
    ▲                      ▲                           │                    │
    │                      └── 30 s abort discard ─────┘                    │
    └──────disarm()────────┘                                                │
    ◄──────────────────────── stop() / 10 min park save ────────────────────┘
```

| Phase | Meaning | Sensors | Auto-end | Persist |
|-------|---------|---------|----------|---------|
| `disarmed` | Default. Host must call `start()`. | Idle — same as today | n/a | n/a |
| `armed` | Auto selected, no trip. **Watch only.** | Sparse OS motion / significant-location / activity. **No** full IMU, **no** trip journal, **no** trip FGS / Live Activity | n/a | n/a |
| `warmup` | Auto `start()` after a short vehicle burst. Same capture pipeline as a trip. | Full GPS+IMU + trip FGS / Live Activity — existing `start({ trigger: "auto" })` | **30 s** below `endSpeedMps` inside `endRadiusM` (same silence rule, shorter hold) | **Discard** — no persist, `lastSession` unchanged |
| `recording` | A trip is running (`trigger` `manual`, or auto after commit). | Same pipeline | Auto: **10 min** park + idle-tail trim. Manual: none | Save as today |

`WatchState`:

| Field | Values |
|-------|--------|
| `mode` | `manual` \| `auto` (host preference) |
| `phase` | `disarmed` \| `armed` \| `warmup` \| `recording` |
| `trigger` | `manual` \| `auto` while a trip is running (warmup or recording); otherwise `null` |
| `suppressed` | `true` after a **manual** `start()` while `mode === "auto"`; cleared on `stop()` |
| `nativeWatch` | `true` when the engine implements `armWatch` (native MotionWatch) |
| `lastFix` | Latest sparse `WatchFix`, or `null` until one arrives |
| `startHoldMs` / `startDistanceM` | How long and far the **probe** start heuristic has been accumulating |

`source` on the client (`native` / `simulated` / `auto`) is **which sensors** run. `trigger` is **why** the trip began. Do not overload `source: "auto"`.

### Manual vs Auto interaction

- **`createHarshy()`** is disarmed (`mode: "manual"`). Existing `start` / `stop` / `recover` callers need no changes.
- **`arm()`** sets `mode: "auto"`. If idle, phase becomes `armed` and the engine starts a sparse watch. If a trip is already running, mode flips to Auto but watch stays down until `stop()`. If native `armWatch` fails (no Always), the client reverts to **manual** and throws.
- **`disarm()`** sets `mode: "manual"` and ends the watch. It does **not** stop a running trip.
- **Manual `start()`** always starts a trip with `trigger: "manual"`. If Auto was armed, the watch tears down and `suppressed` is true until `stop()`.
- **Auto start** is `start({ trigger: "auto" })` from the probe heuristic (hosts should omit `trigger`). Phase is **warmup** until commit.
- **`stop()`** always tears down full capture (today’s contract). If `mode` is still `auto`, the client **re-arms** the watch afterward. A host Stop during warmup **saves**. Only a heuristic warmup abort discards.
- Only **auto-started** trips auto-end. Warmup uses a 30 s park; after commit, 10 min. A suppressed manual trip in Auto mode waits for the user to Stop.

## Start / stop heuristics (v1)

Pure functions in `@harshy/core`: `shouldStartTrip` / `shouldEndTrip`. Native MotionWatch feeds sparse `WatchFix` samples; during an auto trip, commit and end use trip GPS. **Tunables** (not `DetectorConfig`):

| Key | Default | Role |
|-----|---------|------|
| `startSpeedMps` | **10 / 3.6** (10 km/h) | Above a typical walk. A bike can still exceed this |
| `startDistanceM` | **40** | Distance while continuously above start speed to begin **warmup** |
| `startHoldMs` | **5_000** | Time above start speed to begin warmup. At 10 km/h the 40 m distance takes about 14 s, so distance is the longer probe gate |
| `commitDistanceM` | **150** | After warmup `start()`, distance at vehicle speed that **commits** (failed warmup is discarded) |
| `commitHoldMs` | **20_000** | After warmup `start()`, time at vehicle speed that commits |
| `endSpeedMps` | **2.5** | Dwell / stopped gate |
| `endHoldMs` | **600_000** (10 min) | Low-speed timeout before auto `stop()` of a **committed** trip. The parked dwell is then cut from the saved trip |
| `warmupEndHoldMs` | **30_000** | Park timeout while still in warmup (same silence rule as `endHoldMs`) |
| `endRadiusM` | **80** | If the phone moves farther while “slow”, treat as traffic crawl and reset dwell |
| `maxAccuracyM` | **50** | Ignore noisy watch fixes |
| `rejectNonAutomotive` | **true** | Soft transport filter: **cycling** still blocks start. Walking / running **do not** block when speed (reported or inferred) is already at `startSpeedMps` — pocket steps and in-car vibration often look like walking. Slow walking still resets. `unknown` uses kinematics; automotive does not skip speed/distance |

**Probe** (watch → warmup): `shouldStartTrip` with `startHoldMs` / `startDistanceM`. **Commit** (warmup → recording): replay trip GPS through `shouldStartTrip(..., commitStartConfig(config))` (`startHoldMs` ← `commitHoldMs`, `startDistanceM` ← `commitDistanceM`). **Warmup abort**: `shouldEndTrip` with `warmupEndConfig` (`endHoldMs` ← `warmupEndHoldMs`). `schemaVersion` stays **1**; warmup is not persisted.

Start when **both** hold and distance are met. A speed drop below `startSpeedMps` resets accumulation. Missing or ~0 GNSS `speedMps` infers speed from displacement. A gap longer than the inference window (~60 s) without speed **resets** hold/distance (significant-location must not keep a stale accumulation). Poor accuracy is skipped (not a reset). Missing coordinates never start a trip.

End when speed stays below `endSpeedMps` for the active hold (`warmupEndHoldMs` or `endHoldMs`) **and** displacement stays inside `endRadiusM`. A reported 0 is parked; rolling with GPS stuck at 0 still resets via the radius. Missing GNSS speed infers from displacement. Returning to speed or crawling beyond the radius resets dwell (highway crawl should not look like a parking lot). A short GPS gap with no speed does **not** start or clear the park timer. If GPS is **silent for ≥ the active hold** and the next fix is already slow (Doze / FGS gap / process death mid-park), auto-end fires and trims after the last pre-gap sample so the dead journal hole is not kept as trip duration. Committed auto-stop then re-runs `analyzeTrip` on samples through `slowSinceMs` so duration, distance, and events omit that idle tail. A warmup abort tears down FGS / journal **without** `persistSession` / `UploadAdapter` and does **not** replace `lastSession`. A host **Stop** (including during warmup) keeps the recording. `recover()` replays journal GPS through probe-commit and the matching end helper and **auto-stops immediately** when the journal already shows a completed park (or a long silence that resumes parked). If recover is still uncommitted and abort is due, it discard-stops the same way.

Pass overrides to `arm({ heuristic })`. Expect on-road retune; these are a first cut, not calibrated.

## Native MotionWatch

Watch is a **separate** location path from trip capture. `start()` disarms the watch listeners. When Auto will re-arm, `stop({ handoffToWatch: true })` leaves the Android location foreground service running and swaps the notice to “Waiting for a drive”. A fresh `startForegroundService` after that stop is not allowed while the app is backgrounded (`ForegroundServiceStartNotAllowedException`). Manual mode still stops the service.

| Platform | Watch APIs | Activity |
|----------|------------|----------|
| **iOS** | Separate `CLLocationManager`: significant-change plus ~25 m updates with `allowsBackgroundLocationUpdates` while armed, so a locked phone still delivers fixes. The location indicator is on. Does not pause updates automatically. Watch fixes publish immediately; activity comes from the motion stream (not a per-fix query). When the probe gates pass, the engine calls `start(trigger: auto)` itself | `CMMotionActivityManager` (automotive / walk / bike / run). Walking / running at vehicle speed is published as `unknown`. Missing motion still uses kinematics |
| **Android** | Separate `LocationListener`: GPS + platform fused (API 31+, always registered) + network, using fused/network samples only when GPS is off/searching/silent, plus PASSIVE and `TYPE_SIGNIFICANT_MOTION` single-fix wakeups. Last-known older than 30 s is ignored. Searching GPS is not emitted when fused is registered. While armed, the location foreground service stays up so fixes arrive with the screen locked. It shows “Waiting for a drive” until a trip starts. The engine calls `start(trigger: auto)` when the probe gates pass. No trip journal until that start | `ACTIVITY_RECOGNITION` is requested and surfaced on existing `motion`. v1 classifies **walking** from the step detector unless GPS speed is already vehicular; otherwise `unknown`. No Play Services Activity Recognition |

`armWatch` throws if Always / background location is not granted. It no-ops while a trip is `running`. Denied motion does **not** fail `armWatch`.

## Permissions

`requestPermissions()` already prompts when-in-use → Always (iOS) and fine → background location (Android), plus iOS motion. Auto in the background needs **Always / background location**. Android also prompts `ACTIVITY_RECOGNITION` (API 29+) in the first batch so `motion` is real.

| Signal | iOS | Android | When |
|--------|-----|---------|------|
| Background location | Always + (for a **trip**) `location` background mode | `ACCESS_BACKGROUND_LOCATION` | Armed watch: significant-change / sparse location. Trip: existing continuous + FGS |
| Motion / activity | `CMMotionActivityManager` (`motion` on `PermissionResult`) | `ACTIVITY_RECOGNITION` on `motion` (API 29+; granted below 29) | Soft automotive vs walk/bike |
| Notifications | n/a | Location FGS notice: “Waiting for a drive” while armed, trip numbers while recording | Armed watch and trip |

Do not prompt from `arm()` itself — hosts call `requestPermissions()` first.

## Battery / privacy

- Watch is **duty-cycled OS APIs**, not 50 Hz IMU and not 2 Hz GPS. Budget is closer to significant-location / activity transitions than to a trip.
- While Auto is armed, Android keeps a location foreground service (“Waiting for a drive”) and iOS keeps background location updates. That is what lets a trip start with the app closed or the phone locked. The trip journal still begins only when the probe starts the trip.
- Privacy: Auto means the OS may wake the app on motion **without** a user tap. Hosts should make Auto an explicit setting (default Manual) and explain Always location if they expose Auto.
- Local-first export is unchanged: auto only triggers the same start → stop → `SessionExport` path. Nothing is uploaded unless the host set `UploadAdapter`.

## `recover()`

1. Call **`recover()` before `arm()`** on launch so a live trip wins.
2. A recovered trip uses existing Android journal + FGS restore. The journal stores `trigger`; older journals without it recover as `manual` (and `suppressed` if Auto is then armed). Auto trips replay journal GPS through probe-commit and `shouldEndTrip` so a parked dwell (or uncommitted warmup abort) survives process death.
3. Watch is not a trip: process death while **armed** must not start FGS. Re-register the watch on process start (`arm()` after `recover()`).
4. `recover()` must not invent a trip from watch state.

## SDK surface

```ts
const harshy = createHarshy({ nativeAvailable, createNativeEngine });
// Default: manual. Existing start/stop unchanged.

harshy.subscribe({
  onWatchState: (watch) => {
    // watch.phase: "disarmed" | "armed" | "warmup" | "recording"
  },
});

await harshy.requestPermissions();
await harshy.arm(); // opt-in Auto
// … or harshy.start() for a manual trip (suppresses Auto until stop)

await harshy.disarm();
```

`SensorEngine.armWatch` / `disarmWatch` / `subscribeWatch` — simulated engines omit them. Native `createNativeEngine()` implements all three. A `subscribeWatch` test double can feed `WatchFix`es so `shouldStartTrip` calls existing `start({ trigger: "auto" })`.

## Test plan outline

**Shipped in unit tests**

- `shouldStartTrip` / `shouldEndTrip`: probe 5 s / 40 m, commit 20 s / 150 m, speed reset, walk block, poor accuracy, dwell vs traffic crawl, default 10 min park, warmup 30 s abort, idle-tail trim helpers
- Zod: older JSON without `trigger` → `manual`; `schemaVersion` 1; `trigger: "auto"` round-trips
- SDK: default disarmed; `arm` → armed; manual `start` while Auto → suppressed + `trigger: "manual"`; `stop` re-arms and passes `handoffToWatch` while mode is auto; manual `stop` does not; `disarm` does not stop a trip; watch double auto-starts with `trigger: "auto"` and `phase: "warmup"`; keep driving → `recording`; park 30 s in warmup discards (`getLastSession()` unchanged) and re-arms; auto-stop after 10 min park (after commit) drops that dwell from the session; `recover()` of an uncommitted parked journal discards; `armWatch` failure reverts to manual
- Android `WatchFixMaps.activityFromSteps`
- Android journal `meta.json` `trigger` round-trip; native session JSON emits `trigger`; SDK `recover()` keeps snapshot `trigger`

**Device (soak)**

- `arm()` starts the Android watch location foreground service (“Waiting for a drive”), not the trip journal or iOS Live Activity
- Auto start keeps that service, starts the journal / Live Activity; auto `stop` swaps the notice back and re-arms without `startForegroundService`
- Manual Start while Armed suppresses until Stop
- `recover()` mid-trip still attaches with the journaled `trigger`; armed-only process death does not restore a trip
- Walk / bike with activity does not start; a false-start warmup aborts after ~30 s parked and is not persisted; parking 10+ min ends a committed auto trip and omits those parked minutes
- Denied Always: `armWatch` fails without capturing

## Open questions

- On-road calibration of start/end tunables (lights vs parking vs traffic crawl)
- Whether to add Play Services Activity Recognition later (v1 is steps + iOS motion)
- When a hard car vs walk/bike filter replaces today’s soft `rejectNonAutomotive`
