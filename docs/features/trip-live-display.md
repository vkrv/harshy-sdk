# Trip live display

**Status:** shipped

## Summary

While a trip is recording, key numbers are shown on the system surface that stays visible with the screen locked or the app backgrounded. **Android** updates the sticky location foreground-service notification. **iOS** hosts may drive an ActivityKit Live Activity from the same payload.

## Related

- Native: `TripLiveDisplay` / `TripForegroundService` (Android); Expo `HarshyNative.updateTripLiveDisplay`
- JS: `@harshy/sdk` `formatTripLiveDisplay`, `createHarshy({ liveDisplayTitle, formatLiveDisplay })`
- Linked: [driving-sdk.md](driving-sdk.md), [sensors.md](../architecture/sensors.md)

## Behavior

- Payload fields (pre-formatted strings): `title`, `score`, `speed`, `duration`, `distance`.
- Updates are throttled (~1 Hz) from live metrics after `start()` / `recover()`.
- Android: same channel as the trip FGS (`harshy-trip`); silent ongoing notice; tap opens the host app. Small icon is `harshy_trip_notification` in the native module (do not rely on the host app icon / system resource). `startForeground` failures are caught and tear the service down instead of crashing the process. Blank-label fallbacks use **Harshy**; hosts should pass `liveDisplayTitle`.
- iOS Live Activity UI is **host-owned**. The SDK only pushes the payload through `SensorEngine.updateLiveDisplay`. Native `HarshyClient` (Android) also refreshes the FGS notice from analyzer metrics.

## Open questions

- Whether Android should add a custom RemoteViews layout later
- Push-to-update Live Activities from a server (out of scope; local updates only)
