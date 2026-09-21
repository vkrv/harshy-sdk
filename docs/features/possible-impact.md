# Possible impact

**Status:** shipped

## Summary

On-device **possible-impact** heuristic for a crash-like jolt. It is an event on the trip, **not** a confirmed crash, **not** emergency calling, and **not** a score penalty. Direction is only `front` / `rear` / `rollover` / `unknown` — never left/right or a body panel. Phone pose in the cabin is out of scope.

## Related

- Schema: `DrivingEvent.type` `possible_impact`, optional `impactDirection` in `@harshy/core`
- Client: `@harshy/sdk` (`onEvent`, `analyzeTrip`, `isPossibleImpact`, `impactDirectionLabel`); native `HarshyClient` / `isPossibleImpact` / `harshyIsPossibleImpact`
- Linked features: [driving-sdk.md](driving-sdk.md), [session-export.md](session-export.md), [road-quality.md](road-quality.md)

## Behavior

- Pulse: linear accel (else accel − gravity). Open when magnitude ≥ `impactFloorMps2` (~1.5 g); close when it drops below. Peak must reach `impactPeakMps2` (~3.5 g). Width above `impactPulseMaxMs` (400) is treated as accel/brake, not a collision.
- Reject: first `jerkSettleMs` after start; last GPS speed before the pulse below `minSpeedMps`; peak mostly world-up (`impactVerticalMax`); free-fall (`|accel|` < `impactFreeFallMps2` in the lookback — full accel, not linear); `impactCooldownMs` (5 s). No band-upgrade.
- Confirm: GPS `|Δspeed|` ≥ `impactSpeedDeltaMps` (~4 m/s) in `impactLookaheadMs` (2 s). `0` skips the GPS check and confirms from the jolt alone. A ~6 g peak (`impactPeakHighMps2`) can emit `unknown` without a speed change. Streaming holds a pending candidate until GPS arrives, lookahead elapses, or `finalize`.
- Direction: gravity rotating ≳ `impactRolloverDeg` → `rollover`; else speed drop → `front`; speed rise → `rear`; else `unknown`.
- `eventWeight("possible_impact")` is 0. Not in `COMPOUND_EVENT_TYPES`. `eventCounts.possible_impact` defaults to 0 so older JSON still parses. Hosts should not fold this event into their own score.
- Native default `imuHz` is **50** (engines already support 5–100). Detection must still work at 25 Hz.
- Integrate through `@harshy/sdk` or `HarshyClient`. Do not copy pulse math into a host app.
- Do not add a crash pulse to `generateSampleTrip`.

## Open questions

- On-road calibration of peak g and speed-drop after real collisions vs parking taps
- Whether a later pass should estimate left/right (out of scope until asked)
