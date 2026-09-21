# @harshy/native

Standalone **Android (Kotlin)** + **iOS (Swift)** driving SDK, plus an Expo module bridge for React Native.

## Which API?

| Host | Use |
|------|-----|
| Native Android / iOS app | `HarshyClient` (this package). Events, score, and session JSON run on-device. |
| Expo / React Native | `@harshy/sdk` `createHarshy` + this Expo module for sensors. Detector stays in `@harshy/core`. |
| Your own GPS/IMU | JS `analyzeTrip` from `@harshy/sdk`, or Kotlin/Swift `analyzeTrip` / `harshyAnalyzeTrip`. |

Do not construct `HarshyClient` in the same process as the Expo module — both own the engine listener. Expo/RN apps should **not** also add the Android host module or the Swift package; autolinking already compiles these sources.

`@harshy/core` is the canonical detector. The Kotlin/Swift ports follow the same pulse, bands, score, road RMS, possible-impact, and phone-handheld rules.

## Native Android

1. Include the host library (engine + client, no Expo):

```gradle
// settings.gradle
include ':harshy'
project(':harshy').projectDir = new File(settingsDir, '../signumb-sdk/packages/native/android-host')
```

```gradle
// app/build.gradle
dependencies {
  implementation project(':harshy')
}
```

The host app must already apply Android Gradle Plugin 8.x and the Kotlin Android plugin. Merge will pick up location / FGS permissions and `TripForegroundService` from this module’s manifest.

2. Copy-paste:

```kotlin
import com.harshy.sdk.HarshyClient
import com.harshy.sdk.DetectorConfig
import com.harshy.sdk.NativeStartOptions
import com.harshy.sdk.impactDirectionLabel
import com.harshy.sdk.isPhoneHandheld
import com.harshy.sdk.isPossibleImpact

class DriveActivity : AppCompatActivity() {
  private val harshy by lazy { HarshyClient(this) }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    harshy.listener = object : HarshyClient.Listener {
      override fun onEvent(event: com.harshy.sdk.DrivingEvent) {
        if (isPossibleImpact(event)) {
          // Not a confirmed crash, not 911, and it does not change the score.
          Log.i("Harshy", impactDirectionLabel(event.impactDirection))
        }
        if (isPhoneHandheld(event)) {
          // Pickup / hold while moving. Does not change the score.
          Log.i("Harshy", "phone handheld")
        }
      }
    }
    harshy.requestPermissions(this) { status ->
      if (status["location"] == "granted") {
        harshy.start(
          native = NativeStartOptions(imuHz = 50, background = true),
          detector = DetectorConfig.DEFAULT.copy(impactPeakMps2 = 35.0),
        )
      }
    }
  }

  override fun onRequestPermissionsResult(
    requestCode: Int,
    permissions: Array<out String>,
    grantResults: IntArray,
  ) {
    if (harshy.onRequestPermissionsResult(requestCode, permissions, grantResults)) return
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
  }

  fun stopTrip() {
    val session = harshy.stop()
    harshy.setUploadAdapter { json -> /* POST json */ }
    harshy.upload(session)
  }
}
```

`recover()` attaches to a journaled trip after process death. `retune(config)` re-scores the last samples without driving again. `start()` throws `SecurityException` if location is still denied.

Headless (you already have samples):

```kotlin
val session = analyzeTrip(
  location, imu,
  sessionId = "fleet-1",
  startedAtMs = started,
  endedAtMs = ended,
  device = DeviceInfo("android", Build.MODEL),
  config = DetectorConfig.DEFAULT,
)
```

## Native iOS

Add the Swift package at `packages/native` (Xcode → Add Package Dependency → Add Local). It excludes the Expo module.

Info.plist (or the Expo config plugin if you also use RN):

- `NSLocationWhenInUseUsageDescription`
- `NSLocationAlwaysAndWhenInUseUsageDescription`
- `NSMotionUsageDescription`
- `UIBackgroundModes` → `location`

```swift
import Harshy

final class DriveController: HarshyClient.Listener {
  let harshy = HarshyClient()

  func start() {
    harshy.listener = self
    harshy.requestPermissions { status in
      guard status["location"] == "granted" else { return }
      var detector = HarshyDetectorConfig.default
      detector.impactPeakMps2 = 35
      try? self.harshy.start(
        native: HarshyNativeStartOptions(imuHz: 50, background: true),
        detector: detector
      )
    }
  }

  func stop() {
    let session = harshy.stop()
    try? session.toJSONString()
  }

  func harshyClient(_ client: HarshyClient, didEmit event: HarshyDrivingEvent) {
    if harshyIsPossibleImpact(event) {
      print(harshyImpactDirectionLabel(event.impactDirection))
    }
  }
}
```

Headless:

```swift
let session = harshyAnalyzeTrip(
  location: location,
  imu: imu,
  sessionId: "fleet-1",
  startedAtMs: started,
  endedAtMs: ended,
  device: HarshyDeviceInfo(platform: "ios", model: UIDevice.current.model)
)
```

## Expo / React Native

```ts
import HarshyNative from "@harshy/native";

await HarshyNative.requestPermissions();
await HarshyNative.start({ imuHz: 50, locationIntervalMs: 500, background: true });
```

`requestPermissions()` resolves after the user answers the system dialogs (when-in-use then Always on iOS; fine then background location on Android). It does not start GPS or IMU. `start()` throws if location is still denied.

Add the config plugin so permissions, the Android foreground service, and MainActivity `configChanges` are merged:

```json
{
  "expo": {
    "plugins": ["@harshy/native"]
  }
}
```

Host apps should depend on `@harshy/native` directly so Expo autolinking can see the module. Use `@harshy/sdk` as the JS host API — see [`packages/sdk/README.md`](../sdk/README.md).

## Automatic trips

`HarshyEngine` implements a sparse MotionWatch (`armWatch` / `disarmWatch`) used by the Expo module. It must not start the trip FGS, IMU sampler, or `harshy-trip/` journal. Native `HarshyClient` stays start/stop/recover — JS `createHarshy` owns the start/stop heuristic. Full GPS+IMU and the trip FGS still start only in `start()` and end in `stop()`, except Expo `startPreview` / `stopPreview` (foreground GPS+IMU readout, not a trip, no FGS/journal). The Android trip journal stores `trigger` so recover after process death keeps auto vs manual. See [Automatic trips](../../docs/features/auto-trip.md).

## Tests

```bash
# From repo root (also runs under pnpm test)
pnpm --filter @harshy/native test          # Android JUnit + Swift HarshyMath on macOS
pnpm --filter @harshy/native test:android  # :harshy:testDebugUnitTest via android-unit/
pnpm --filter @harshy/native test:ios      # swift test (macOS only)
```

Android suites live under `android/src/test/java` (detector parity, sample maps, harsh bands, trip-live copy, RoadStamp, idle gate, assessRoad, watch maps, journal trigger). Swift parity is `Tests/HarshyMathTests` via the `HarshyMath` package (analyzer, heading, road, idle, maps, watch activity, RoadStamp).
