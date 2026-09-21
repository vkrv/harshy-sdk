# Phone handheld

**Status:** shipped

## Summary

On-device **phone_handheld** span when the phone is picked up or held while the vehicle is moving. IMU gravity tilt from a quiet mount baseline plus handling motion (gyro or linear accel). It is an event on the trip, **not** a score penalty, and **not** screen-unlock detection.

## Related

- Schema: `DrivingEvent.type` `phone_handheld` in `@harshy/core`
- Client: `@harshy/sdk` (`onEvent`, `analyzeTrip`, `isPhoneHandheld`); native `isPhoneHandheld` / `harshyIsPhoneHandheld`
- Linked features: [driving-sdk.md](driving-sdk.md), [session-export.md](session-export.md), [possible-impact.md](possible-impact.md)

## Behavior

- While the phone is quiet (low gyro + low linear accel) for `handheldStableMs`, gravity EMA becomes the **mount baseline**.
- While GPS speed ≥ `minSpeedMps` and after `jerkSettleMs`: a tilt of ≥ `handheldTiltDeg` from that baseline **with** handling motion starts a candidate; after `handheldConfirmMs` of sustained tilt, open a span (`endT` null).
- Stay open while tilt stays elevated (held still still counts). Close when tilt stays below `handheldExitTiltDeg` (or the car stops) for `handheldExitMs`, then `handheldCooldownMs` before another open.
- Peak is gravity tilt in degrees. Light / medium / heavy vs `handheldTiltDeg` × medium/heavy multipliers.
- `eventWeight("phone_handheld")` is 0. Not in `COMPOUND_EVENT_TYPES`. `eventCounts.phone_handheld` defaults to 0 so older JSON still parses.
- Integrate through `@harshy/sdk` or `HarshyClient`. Do not copy handheld math into a host app.
- Native Kotlin/Swift analyzers mirror the JS detector for `HarshyClient`.

## Open questions

- On-road calibration of tilt / gyro for cup-holder vs dash mounts
- Whether a later pass should add screen-use signals (out of scope for this event)
