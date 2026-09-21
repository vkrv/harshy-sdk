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

- `schemaVersion: 1`
- Optional `trigger`: `manual` | `auto` — why capture began (not sensor `source`). New `analyzeTrip` / `stop()` output always sets it. **Older JSON omits it**; `parseSessionExport` fills `manual`. Do not bump `schemaVersion`. Native Kotlin/Swift JSON emits `trigger` (`manual` when omitted). The Android in-progress journal stores `trigger` so `recover()` keeps auto vs manual after process death.
- Events include `level`: `light` | `medium` | `heavy` (defaults to `light` when parsing older JSON) and `overlaps` (other kinematic types in the compound window; defaults to `[]`). Speeding events use `endT` for the span. `possible_impact` may include `impactDirection` (`front` | `rear` | `rollover` | `unknown`). `phone_handheld` is a span (`endT`) for pickup/hold while moving. Detector config includes `harshMediumX` (1.5), `harshHeavyX` (2), `harshSwerveRadps`, `compoundWindowMs`, `jerkSettleMs` (1.5 s), `impact*` keys, and `handheld*` keys; omitted values fill from defaults.
- `eventCounts.possible_impact` and `eventCounts.phone_handheld` default to 0 so older JSON still parses. Neither changes `metrics.score`.
- Optional `location.roadRmsMps2` is filled online as GPS advances (native engines stamp it at capture; JS finalize keeps it when IMU is omitted). Missing on older trips. Compact archive JSON (`compactSessionExport`) keeps `speedMps`, `accuracyM`, and `roadRmsMps2`, and drops IMU. Not used for scoring.
- Live sample rings are capped (`MAX_LOCATION_SAMPLES`, ~2 h of IMU). Idle thinning skips IMU below `minSpeedMps` (hysteresis). Expo/native `stop()` finalizes the live analyzer; do not bridge uncapped IMU.
- `stop()` canonicalizes events by re-analyzing recorded samples
- Optional `createHarshy({ historyStore })` writes compact sessions to a `JsonFileStore` (memory, AsyncStorage prefix, or documents). `loadHistory()` on a new client with the same store returns those trips after a reload. Persist failures surface from `stop()` / `onError` — they do not silently drop the in-memory session. If the host already persists trips, do not also pass `historyStore`.
- `upload(session)` validates with Zod then calls the adapter
- Missing adapter throws; it does not silently no-op

## Open questions

- Compression / full multi-hour IMU streaming for export (capped rings + idle skip are the current approach)
- Auth headers for the first hosted collector
