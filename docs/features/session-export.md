# Session export and upload

**Status:** in-progress

## Summary

Every trip produces a versioned JSON document with samples, events, metrics, detector config, and device info. Hosts can persist it locally or send it later through `UploadAdapter`.

## Related

- Schema: `sessionExportSchema` in `@harshy/core`
- API: none in this repo (adapter is host-owned)
- Client: `@harshy/sdk` `upload()` / `setUploadAdapter()`; optional `historyStore` (compact local archive); native `HarshyClient.upload`
- Linked features: [driving-sdk.md](driving-sdk.md), [road-quality.md](road-quality.md), [possible-impact.md](possible-impact.md), [phone-handheld.md](phone-handheld.md), [auto-trip.md](auto-trip.md)

## Behavior

- `schemaVersion: 1` (JSON shape; stays 1 for additive fields)
- `sdkVersion`: monotonic Harshy SDK stamp (`HARSHY_SDK_VERSION`). Always set on new `analyzeTrip` / `stop()` output. **Older JSON omits it.** Bump by 1 on every intentional SDK behavior or export-shape change — not package semver. Do not bump `schemaVersion` for that.
- Optional `trigger`: `manual` | `auto` — why capture began (not sensor `source`). New `analyzeTrip` / `stop()` output always sets it. **Older JSON omits it**; `parseSessionExport` fills `manual`. Do not bump `schemaVersion`. Native Kotlin/Swift JSON emits `trigger` (`manual` when omitted). The Android in-progress journal stores `trigger` so `recover()` keeps auto vs manual after process death. **Source of truth for why the trip began is the top-level `trigger` field.** When `capture.trigger` is also present it should match; prefer the top-level value if they ever disagree.
- Optional `capture`: the `NativeStartOptions` used to start the trip (`imuHz`, `locationIntervalMs`, `background`, and optional `trigger`). Preserved so the export records the settings that produced the results. New `analyzeTrip` / `stop()` output sets it when the capture options are known; **older JSON omits it** and `parseSessionExport` leaves it absent. Partial `capture` objects parse (missing fields fill from defaults). Native Kotlin/Swift JSON emits `capture` when present; `capture.trigger` is omitted when unset. Android/iOS snapshots echo the live capture options so `recover()` / attach reuse the original settings, not the host’s current defaults. Do not bump `schemaVersion`.
- Events include `level`: `light` | `medium` | `heavy` (defaults to `light` when parsing older JSON) and `overlaps` (other kinematic types in the compound window; defaults to `[]`). Speeding events use `endT` for the span. `possible_impact` may include `impactDirection` (`front` | `rear` | `rollover` | `unknown`). `phone_handheld` is a span (`endT`) for pickup/hold while moving. Detector config includes `harshMediumX` (1.5), `harshHeavyX` (2), `harshSwerveRadps`, `harshSwerveJerkRadps2`, `swerveMinSpeedMps`, `swerveMaxElevatedMs`, `compoundWindowMs`, `jerkSettleMs` (1.5 s), `impact*` keys, and `handheld*` keys; omitted values fill from defaults.
- `eventCounts.possible_impact` and `eventCounts.phone_handheld` default to 0 so older JSON still parses. Neither changes `metrics.score`.
- Optional `location.roadRmsMps2` is filled online as GPS advances (native engines stamp it at capture; JS finalize keeps it when IMU is omitted). Missing on older trips. Compact archive JSON (`compactSessionExport` / `stringifySessionExport`; Kotlin `compactSessionExport` builds the same shape) keeps `speedMps`, `accuracyM`, and `roadRmsMps2` when set, drops IMU, and omits null `altitudeM`, `altitudeAccuracyM`, `courseDeg`, `roadRmsMps2`, `speedLimitMps`, event `endT`, and `speedingMps`. Optional `location.speedLimitMps` is the mapped limit for that fix. A speeding event’s `speedLimitMps` is the cap that span used. Both are omitted when null and are not a score input. Parsers fill those omissions as null. Not used for scoring.
- Live sample rings: GPS is capped at `MAX_LOCATION_SAMPLES`. The Android engine IMU deque keeps **2 minutes**; the IMU journal file keeps **1 hour** and recover loads only that 2-minute tail. The JS analyzer ring stays ~2 h of IMU. Idle thinning skips IMU below `minSpeedMps` (hysteresis). Expo/native `stop()` finalizes the live analyzer; do not bridge uncapped IMU.
- `stop()` canonicalizes events by re-analyzing recorded samples
- Optional `createHarshy({ historyStore })` writes compact sessions to a `JsonFileStore` (memory, AsyncStorage prefix, or documents). `loadHistory()` on a new client with the same store returns those trips after a reload. Persist failures surface from `stop()` / `onError` — they do not silently drop the in-memory session. If the host already persists trips, do not also pass `historyStore`.
- `upload(session)` validates with Zod then calls the adapter
- Missing adapter throws; it does not silently no-op

## Open questions

- Compression / full multi-hour IMU streaming for export (capped rings + idle skip are the current approach)
- Auth headers for the first hosted collector
