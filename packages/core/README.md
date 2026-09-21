# @harshy/core

Canonical on-device detector and session schema for the Signumb driving-quality SDK. Pure TypeScript: no React Native, no Expo.

Hosts should depend on [`@harshy/sdk`](../sdk) (JavaScript / Expo) or `HarshyClient` in [`@harshy/native`](../native) (Kotlin / Swift). Do not copy detector math into a host app.

## What it owns

- GPS/IMU sample types and Zod `SessionExport`
- Harsh accel / brake / corner / swerve, optional speeding spans, IMU jerk fallback
- Compound overlap tags, possible-impact heuristic, phone-handheld spans
- Road RMS on the path (`roadRmsMps2`) — not a score
- Trip score and `analyzeTrip` / `TripAnalyzer`
- Auto-trip heuristics (`shouldStartTrip` / `shouldEndTrip`)

## Scripts

```bash
pnpm --filter @harshy/core test
pnpm --filter @harshy/core typecheck
```
