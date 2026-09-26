package expo.modules.harshynative

import android.Manifest
import android.os.Build
import com.harshy.engine.HarshyEngine
import expo.modules.interfaces.permissions.PermissionsResponseListener
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class HarshyNativeModule : Module() {
  private var engine: HarshyEngine? = null

  override fun definition() = ModuleDefinition {
    Name("HarshyNative")

    Events("onLocation", "onImuBatch", "onState", "onError", "onWatchFix")

    AsyncFunction("getCapabilities") {
      engine().capabilities()
    }

    AsyncFunction("getPermissionStatus") {
      engine().permissionStatus()
    }

    AsyncFunction("requestPermissions") { promise: Promise ->
      ask(promise, foregroundPermissions())
    }

    AsyncFunction("requestPermission") { kind: String, promise: Promise ->
      if (kind == "backgroundLocation") {
        requestBackground(promise)
        return@AsyncFunction
      }
      ask(promise, permissionsFor(kind))
    }

    AsyncFunction("requestBackgroundLocation") { promise: Promise ->
      requestBackground(promise)
    }

    AsyncFunction("start") { options: Map<String, Any?> ->
      engine().start(options)
    }

    AsyncFunction("startPreview") { options: Map<String, Any?> ->
      engine().startPreview(options)
    }

    AsyncFunction("stopPreview") {
      engine().stopPreview()
    }

    AsyncFunction("stop") { options: Map<String, Any?>? ->
      // Live JS analyzer already holds a capped ring; skip bridging full IMU.
      // Auto re-arm keeps the location FGS so we do not startForegroundService in the background.
      val handoff = options?.get("handoffToWatch") as? Boolean ?: false
      engine().stop(includeImu = false, handoffToWatch = handoff)
    }

    AsyncFunction("getSnapshot") {
      // Recover replays GPS into the analyzer; IMU stays on the native ring.
      engine().snapshot(includeImu = false)
    }

    AsyncFunction("isRunning") {
      val eng = engine()
      // Resume a journaled trip only when the host asks if capture is live (recover / start attach).
      eng.restoreIfNeeded()
      eng.isRunning()
    }

    AsyncFunction("updateTripLiveDisplay") { payload: Map<String, Any?> ->
      val context = appContext.reactContext?.applicationContext
        ?: appContext.currentActivity?.applicationContext
        ?: return@AsyncFunction
      val label = context.applicationInfo.loadLabel(context.packageManager)?.toString().orEmpty()
        .ifBlank { "Signumb" }
      com.harshy.engine.TripLiveDisplay.update(
        context,
        com.harshy.sdk.tripLivePayloadFromMap(payload, label),
      )
    }

    AsyncFunction("clearTripLiveDisplay") {
      com.harshy.engine.TripLiveDisplay.clearCache()
    }

    AsyncFunction("armWatch") {
      engine().armWatch()
    }

    AsyncFunction("disarmWatch") {
      engine().disarmWatch()
    }
  }

  private fun engine(): HarshyEngine {
    val reactContext = appContext.reactContext
      ?: appContext.currentActivity
      ?: throw IllegalStateException("No Android context available")
    val created = HarshyEngine.shared(reactContext.applicationContext)
    created.listener = object : HarshyEngine.Listener {
      override fun onLocation(sample: Map<String, Any?>) {
        sendEvent("onLocation", sample)
      }

      override fun onImuBatch(samples: List<Map<String, Any?>>) {
        sendEvent("onImuBatch", mapOf("samples" to samples))
      }

      override fun onState(state: Map<String, Any?>) {
        sendEvent("onState", state)
      }

      override fun onError(error: Map<String, Any?>) {
        sendEvent("onError", error)
      }

      override fun onWatchFix(sample: Map<String, Any?>) {
        sendEvent("onWatchFix", sample)
      }
    }
    // Do not restore here — permission / capability probes must not start the FGS.
    // Journal resume runs from TripForegroundService and explicit isRunning/start/recover paths.
    engine = created
    return created
  }

  private fun foregroundPermissions(): List<String> {
    val foreground = mutableListOf(
      Manifest.permission.ACCESS_FINE_LOCATION,
      Manifest.permission.ACCESS_COARSE_LOCATION,
    )
    foreground.addAll(permissionsFor("notifications"))
    foreground.addAll(permissionsFor("motion"))
    return foreground
  }

  private fun permissionsFor(kind: String): List<String> {
    return when (kind) {
      "location" -> listOf(
        Manifest.permission.ACCESS_FINE_LOCATION,
        Manifest.permission.ACCESS_COARSE_LOCATION,
      )
      "notifications" ->
        if (Build.VERSION.SDK_INT >= 33) listOf(Manifest.permission.POST_NOTIFICATIONS) else emptyList()
      "motion" ->
        if (Build.VERSION.SDK_INT >= 29) listOf(Manifest.permission.ACTIVITY_RECOGNITION) else emptyList()
      else -> emptyList()
    }
  }

  private fun ask(promise: Promise, permissions: List<String>) {
    val manager = appContext.permissions
    if (manager == null) {
      promise.reject(
        "E_NO_PERMISSIONS",
        "Permissions module is null. Are you sure all the installed Expo modules are properly linked?",
        null,
      )
      return
    }
    if (permissions.isEmpty()) {
      promise.resolve(engine().permissionStatus())
      return
    }
    manager.askForPermissions(
      PermissionsResponseListener {
        promise.resolve(engine().permissionStatus())
      },
      *permissions.toTypedArray(),
    )
  }

  private fun requestBackground(promise: Promise) {
    val status = engine().permissionStatus()
    if (Build.VERSION.SDK_INT < 29 || status["backgroundLocation"] == "granted" || status["location"] != "granted") {
      promise.resolve(status)
      return
    }
    ask(promise, listOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION))
  }
}
