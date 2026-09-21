# Road quality

**Status:** shipped

## Summary

Hosts can color a GPS path by pavement roughness. The signal is world-up linear-acceleration RMS from the phone IMU, stored as an optional per-point value on the trip. It is a **path measure** — not a harsh event and **not a score penalty**. Pavement is not driver behavior.

## Related

- Schema: `LocationSample.roadRmsMps2` in `@harshy/core`
- Client: `@harshy/sdk` / `HarshyClient` session `location[]`; `assessRoad` / `assessTripRoad` in `@harshy/core`
- Linked features: [driving-sdk.md](driving-sdk.md), [session-export.md](session-export.md), [possible-impact.md](possible-impact.md)

## Behavior

- `assessRoad` projects `linearAccel` (else `accel`) onto the gravity unit vector so phone-Z is not assumed “up” in a cup holder. Fallback is `linearAccel.z`.
- RMS of that vertical component in a 1 s window is assigned to each GPS sample by time.
- The first `jerkSettleMs` (1.5 s) after trip start is ignored so the Start haptic is not a pothole. Samples below `minSpeedMps` are ignored so idle rumble is not a defect.
- `analyzeTrip` / session `finalize` fill `location.roadRmsMps2` when IMU is present. Native Android/iOS engines also **stamp `roadRmsMps2` on each GPS sample at capture** (and use wall-clock `t` aligned with IMU) so Expo `stop()` can omit IMU and compact history still has Road. When IMU is empty, `assessRoad` keeps stored RMS so retune does not wipe the path.
- Simulated trips include a few vertical bumps so hosts can exercise Road without a device.
- Compact JSON keeps `speedMps` and `roadRmsMps2` and still drops IMU.
- `assessTripRoad` returns a whole-trip qualitative label (Smooth / Mostly smooth / Uneven / Rough). Path coloring is typically relative to the trip peak; the label uses absolute bands so two smooth trips are not both labeled “rough” just because one peak is redder.
- Older trips without the field have no road RMS until a new recording.

## Open questions

- Whether to add a driving-score penalty for defective pavement later (out of scope until asked)
