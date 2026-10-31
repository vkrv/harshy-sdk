# Trip live display

**Status:** shipped

## Summary

While a trip is recording, key numbers are shown on the system surface that stays visible with the screen locked or the app backgrounded. **Android** updates the sticky location foreground-service notification and, on Android 16 Live Updates–capable devices, requests a promoted ongoing notice with the **score** in the status-bar chip (`setRequestPromotedOngoing` + `setShortCriticalText`). **iOS** hosts may drive an ActivityKit Live Activity from the same payload.

## Related

- Native: `TripLiveDisplay` / `TripForegroundService` (Android); Expo `HarshyNative.updateTripLiveDisplay`
- JS: `@harshy/sdk` `formatTripLiveDisplay`, `createHarshy({ liveDisplayTitle, formatLiveDisplay })`
- Linked: [driving-sdk.md](driving-sdk.md), [sensors.md](../architecture/sensors.md)

## Behavior

- Payload fields (pre-formatted strings): `title`, `score`, `speed`, `duration`, `distance`.
- Updates are throttled (~1 Hz) from live metrics after `start()` / `recover()`.
- Android: same channel as the trip FGS (`harshy-trip`); silent ongoing notice; tap opens the host app. Small icon is `harshy_trip_notification` in the native module (do not rely on the host app icon / system resource). Trip notices request Live Update promotion (`POST_PROMOTED_NOTIFICATIONS`, `androidx.core` **1.17+**) and put the score in the status chip; older OS versions keep the shade line only. `startForeground` failures are caught and tear the service down instead of crashing the process. While only the watch is armed, the same service shows “Waiting for a drive” (not promoted). Blank-label fallbacks use **Apexmatic**; hosts should pass `liveDisplayTitle`.
- iOS Live Activity UI is **host-owned**. The SDK only pushes the payload through `SensorEngine.updateLiveDisplay`. Native `HarshyClient` (Android) also refreshes the FGS notice from analyzer metrics.

## Open questions

- Whether Android should use `MetricStyle` for a richer promoted card (custom `RemoteViews` are not allowed for Live Updates)
- Push-to-update Live Activities from a server (out of scope; local updates only)
