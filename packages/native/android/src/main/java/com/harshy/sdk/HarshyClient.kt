package com.harshy.sdk

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.harshy.engine.HarshyEngine
import com.harshy.engine.TripIdleGate
import com.harshy.engine.parseTripTrigger

/**
 * Host API for native Android apps. Mirrors JS `createHarshy`: sensors via
 * [HarshyEngine], events/score via the on-device detector.
 *
 * Do not use this in the same process as the Expo module — both own the engine listener.
 */
class HarshyClient @JvmOverloads constructor(
  context: Context,
  engine: HarshyEngine? = null,
) {
  interface Listener {
    fun onLocation(sample: LocationSample) {}
    fun onImu(sample: ImuSample) {}
    fun onMetrics(metrics: LiveMetrics) {}
    fun onEvent(event: DrivingEvent) {}
    fun onState(state: ClientState) {}
    fun onError(code: String, message: String) {}
  }

  private val appContext = context.applicationContext
  private val engine = engine ?: HarshyEngine.shared(appContext)
  private val lock = Any()

  @Volatile var listener: Listener? = null

  private var analyzer: TripAnalyzer? = null
  private var detectorConfig: DetectorConfig = DetectorConfig.DEFAULT
  private var lastSession: SessionExport? = null
  private var lastRaw: RawTrip? = null
  private var uploadAdapter: UploadAdapter? = null
  private var running = false
  private var sessionId: String? = null
  private var permissionDone: ((Map<String, String>) -> Unit)? = null

  private data class RawTrip(
    var location: MutableList<LocationSample>,
    var imu: MutableList<ImuSample>,
    var startedAtMs: Double,
    var endedAtMs: Double,
    var sessionId: String,
    var device: DeviceInfo,
    var trigger: String = "manual",
  )

  private val engineListener = object : HarshyEngine.Listener {
    override fun onLocation(sample: Map<String, Any?>) {
      val parsed = parseLocationSample(sample) ?: return
      val result = synchronized(lock) {
        lastRaw?.location?.add(parsed)
        trimLastRawLocked()
        analyzer?.pushLocation(parsed)
      }
      listener?.onLocation(parsed)
      emitPush(result)
    }

    override fun onImuBatch(samples: List<Map<String, Any?>>) {
      for (sample in samples) {
        val parsed = parseImuSample(sample) ?: continue
        val result = synchronized(lock) {
          lastRaw?.imu?.add(parsed)
          trimLastRawLocked()
          analyzer?.pushImu(parsed)
        }
        listener?.onImu(parsed)
        emitPush(result)
      }
    }

    override fun onState(state: Map<String, Any?>) {
      emitClientState()
    }

    override fun onError(error: Map<String, Any?>) {
      val code = error["code"] as? String ?: "engine"
      val message = error["message"] as? String ?: "Native engine error"
      listener?.onError(code, message)
    }
  }

  fun getState(): ClientState = synchronized(lock) {
    ClientState(running = running, source = if (running) "native" else "idle", sessionId = sessionId)
  }

  fun getDetectorConfig(): DetectorConfig = synchronized(lock) {
    detectorConfig.copy(score = detectorConfig.score.copy())
  }

  fun setDetectorConfig(config: DetectorConfig): SessionExport? {
    synchronized(lock) {
      detectorConfig = mergeDetectorConfig(config)
      analyzer?.setConfig(detectorConfig)
    }
    return retune(detectorConfig)
  }

  fun getLastSession(): SessionExport? = lastSession

  fun capabilities(): Map<String, Any> = engine.capabilities()

  fun permissionStatus(): Map<String, String> = engine.permissionStatus()

  /**
   * Prompts for fine/coarse location (and notifications on API 33+, activity on API 29+).
   * Does not request background location. The host [Activity] must forward
   * [Activity.onRequestPermissionsResult] to [onRequestPermissionsResult].
   */
  fun requestPermissions(activity: Activity, onDone: (Map<String, String>) -> Unit = {}) {
    chainBackground = false
    beginForegroundPermissions(activity, onDone)
  }

  /**
   * Background location on API 29+. Call only after an in-app prominent disclosure.
   * Asks for foreground location first when that is still missing.
   */
  fun requestBackgroundLocation(activity: Activity, onDone: (Map<String, String>) -> Unit = {}) {
    chainBackground = true
    beginForegroundPermissions(activity, onDone)
  }

  private fun beginForegroundPermissions(activity: Activity, onDone: (Map<String, String>) -> Unit) {
    permissionActivity = activity
    permissionDone = onDone
    val foreground = foregroundPermissions()
    val missing = foreground.filter {
      ContextCompat.checkSelfPermission(activity, it) != PackageManager.PERMISSION_GRANTED
    }
    if (missing.isEmpty()) {
      if (chainBackground) {
        requestBackgroundIfNeeded(activity, onDone)
      } else {
        permissionDone = null
        permissionActivity = null
        onDone(engine.permissionStatus())
      }
      return
    }
    ActivityCompat.requestPermissions(activity, missing.toTypedArray(), REQUEST_FOREGROUND)
  }

  fun onRequestPermissionsResult(
    requestCode: Int,
    @Suppress("UNUSED_PARAMETER") permissions: Array<out String>,
    @Suppress("UNUSED_PARAMETER") grantResults: IntArray,
  ): Boolean {
    val activity = findActivityFromPermissions() ?: run {
      if (requestCode == REQUEST_FOREGROUND || requestCode == REQUEST_BACKGROUND) {
        permissionDone?.invoke(engine.permissionStatus())
        permissionDone = null
        return true
      }
      return false
    }
    if (requestCode == REQUEST_FOREGROUND) {
      if (chainBackground) {
        requestBackgroundIfNeeded(activity, permissionDone ?: {})
      } else {
        val done = permissionDone
        permissionDone = null
        permissionActivity = null
        done?.invoke(engine.permissionStatus())
      }
      return true
    }
    if (requestCode == REQUEST_BACKGROUND) {
      val done = permissionDone
      permissionDone = null
      done?.invoke(engine.permissionStatus())
      return true
    }
    return false
  }

  /**
   * Start GPS/IMU. Throws [SecurityException] if location is not granted.
   * Default IMU rate is 50 Hz (same as JS `DEFAULT_NATIVE_START_OPTIONS`).
   */
  fun start(
    native: NativeStartOptions = NativeStartOptions(),
    detector: DetectorConfig? = null,
    device: DeviceInfo = defaultDevice(),
  ) {
    if (running) {
      stop()
    }
    engine.listener = engineListener
    if (attachIfRunning(detector, device)) {
      return
    }
    val merged = mergeDetectorConfig(detector ?: detectorConfig)
    val id = newSessionId()
    val startedAtMs = System.currentTimeMillis().toDouble()
    val trigger = parseTripTrigger(native.trigger)
    synchronized(lock) {
      detectorConfig = merged
      sessionId = id
      analyzer = TripAnalyzer(merged, id, startedAtMs, device, trigger)
      lastRaw = RawTrip(
        location = mutableListOf(),
        imu = mutableListOf(),
        startedAtMs = startedAtMs,
        endedAtMs = startedAtMs,
        sessionId = id,
        device = device,
        trigger = trigger,
      )
    }
    try {
      engine.start(
        mapOf(
          "imuHz" to native.imuHz,
          "locationIntervalMs" to native.locationIntervalMs,
          "background" to native.background,
          "trigger" to trigger,
        ),
      )
    } catch (error: Exception) {
      synchronized(lock) {
        analyzer = null
        lastRaw = null
        running = false
        sessionId = null
      }
      emitClientState()
      throw error
    }
    synchronized(lock) {
      running = true
    }
    emitClientState()
  }

  /** Attach to a journaled trip after process death. */
  fun recover(
    detector: DetectorConfig? = null,
    device: DeviceInfo = defaultDevice(),
  ): Boolean {
    engine.listener = engineListener
    engine.restoreIfNeeded()
    return attachIfRunning(detector, device)
  }

  fun stop(): SessionExport {
    val live: TripAnalyzer?
    val prior: RawTrip?
    synchronized(lock) {
      live = analyzer
      prior = lastRaw
    }
    val snap = engine.stop(includeImu = false)
    engine.listener = null
    val parsedLocation = parseLocationList(snap["location"])
    val startedAtMs = snap["startedAtMs"].asDouble() ?: prior?.startedAtMs ?: System.currentTimeMillis().toDouble()
    val endedAtMs = snap["endedAtMs"].asDouble() ?: System.currentTimeMillis().toDouble()
    val id = (snap["sessionId"] as? String) ?: sessionId ?: prior?.sessionId ?: newSessionId()
    val device = prior?.device ?: defaultDevice()
    val config: DetectorConfig
    val session: SessionExport
    synchronized(lock) {
      config = detectorConfig
      if (live != null && prior != null) {
        val lastT = prior.location.lastOrNull()?.t ?: Double.NEGATIVE_INFINITY
        for (sample in parsedLocation) {
          if (sample.t > lastT) {
            live.pushLocation(sample)
            prior.location.add(sample)
          }
        }
        trimLastRawLocked()
        session = live.finalize(endedAtMs)
        lastRaw = RawTrip(
          location = session.location.toMutableList(),
          imu = session.imu.toMutableList(),
          startedAtMs = prior.startedAtMs,
          endedAtMs = endedAtMs,
          sessionId = session.sessionId,
          device = device,
          trigger = session.trigger,
        )
      } else {
        val trigger = parseTripTrigger((snap["trigger"] as? String) ?: prior?.trigger)
        session = analyzeTrip(
          location = parsedLocation,
          imu = emptyList(),
          sessionId = id,
          startedAtMs = startedAtMs,
          endedAtMs = endedAtMs,
          device = device,
          config = config,
          trigger = trigger,
        )
        lastRaw = RawTrip(
          location = session.location.toMutableList(),
          imu = session.imu.toMutableList(),
          startedAtMs = startedAtMs,
          endedAtMs = endedAtMs,
          sessionId = id,
          device = device,
          trigger = trigger,
        )
      }
      running = false
      sessionId = null
      analyzer = null
    }
    emitClientState()
    lastSession = session
    return session
  }

  fun retune(config: DetectorConfig? = null): SessionExport? {
    val raw: RawTrip
    val merged: DetectorConfig
    synchronized(lock) {
      raw = lastRaw ?: return lastSession
      merged = mergeDetectorConfig(config ?: detectorConfig)
      detectorConfig = merged
    }
    val session = analyzeTrip(
      location = raw.location.toList(),
      imu = raw.imu.toList(),
      sessionId = raw.sessionId,
      startedAtMs = raw.startedAtMs,
      endedAtMs = raw.endedAtMs,
      device = raw.device,
      config = merged,
      trigger = raw.trigger,
    )
    lastSession = session
    return session
  }

  fun setUploadAdapter(adapter: UploadAdapter?) {
    uploadAdapter = adapter
  }

  fun upload(session: SessionExport? = lastSession) {
    val payload = session ?: lastSession ?: throw IllegalStateException("No session to upload")
    val adapter = uploadAdapter ?: throw IllegalStateException("No upload adapter")
    adapter.upload(payload.toJson())
  }

  private fun attachIfRunning(detector: DetectorConfig?, device: DeviceInfo): Boolean {
    if (!engine.isRunning()) {
      return false
    }
    val snap = engine.snapshot(includeImu = true)
    val parsedLocation = parseLocationList(snap["location"])
    val parsedImu = parseImuList(snap["imu"])
    if (snap["sessionId"] == null && parsedLocation.isEmpty()) {
      return false
    }
    val id = (snap["sessionId"] as? String) ?: sessionId ?: newSessionId()
    val startedAtMs = snap["startedAtMs"].asDouble() ?: System.currentTimeMillis().toDouble()
    val merged = mergeDetectorConfig(detector ?: detectorConfig)
    val trigger = parseTripTrigger(snap["trigger"] as? String)
    val next = TripAnalyzer(merged, id, startedAtMs, device, trigger)
    var lastMetrics: LiveMetrics? = null
    for (sample in parsedLocation) {
      lastMetrics = next.pushLocation(sample).metrics
    }
    for (sample in parsedImu) {
      next.pushImu(sample)
    }
    synchronized(lock) {
      detectorConfig = merged
      sessionId = id
      analyzer = next
      lastRaw = RawTrip(
        location = parsedLocation.toMutableList(),
        imu = parsedImu.toMutableList(),
        startedAtMs = startedAtMs,
        endedAtMs = snap["endedAtMs"].asDouble() ?: startedAtMs,
        sessionId = id,
        device = device,
        trigger = trigger,
      )
      trimLastRawLocked()
      running = true
    }
    emitClientState()
    lastMetrics?.let { listener?.onMetrics(it) }
    return true
  }

  private fun trimLastRawLocked() {
    val raw = lastRaw ?: return
    val maxLoc = TripIdleGate.MAX_LOCATION_SAMPLES
    if (raw.location.size > maxLoc) {
      val target = TripIdleGate.ringTarget(maxLoc)
      raw.location.subList(0, raw.location.size - target).clear()
    }
    val maxImu = TripIdleGate.maxImuSamples(50)
    if (raw.imu.size > maxImu) {
      val target = TripIdleGate.ringTarget(maxImu)
      raw.imu.subList(0, raw.imu.size - target).clear()
    }
  }

  private fun emitPush(result: AnalyzerPush?) {
    if (result == null) {
      return
    }
    listener?.onMetrics(result.metrics)
    publishTripLive(appContext, result.metrics)
    for (event in result.newEvents) {
      listener?.onEvent(event)
    }
  }

  private fun emitClientState() {
    listener?.onState(getState())
  }

  private fun defaultDevice(): DeviceInfo {
    return DeviceInfo(platform = "android", model = Build.MODEL)
  }

  private fun foregroundPermissions(): List<String> {
    val list = mutableListOf(
      Manifest.permission.ACCESS_FINE_LOCATION,
      Manifest.permission.ACCESS_COARSE_LOCATION,
    )
    if (Build.VERSION.SDK_INT >= 33) {
      list.add(Manifest.permission.POST_NOTIFICATIONS)
    }
    if (Build.VERSION.SDK_INT >= 29) {
      list.add(Manifest.permission.ACTIVITY_RECOGNITION)
    }
    return list
  }

  private var permissionActivity: Activity? = null
  private var chainBackground = false

  private fun requestBackgroundIfNeeded(activity: Activity, onDone: (Map<String, String>) -> Unit) {
    permissionActivity = activity
    if (
      Build.VERSION.SDK_INT >= 29 &&
      ContextCompat.checkSelfPermission(activity, Manifest.permission.ACCESS_FINE_LOCATION) ==
      PackageManager.PERMISSION_GRANTED &&
      ContextCompat.checkSelfPermission(activity, Manifest.permission.ACCESS_BACKGROUND_LOCATION) !=
      PackageManager.PERMISSION_GRANTED
    ) {
      permissionDone = onDone
      ActivityCompat.requestPermissions(
        activity,
        arrayOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION),
        REQUEST_BACKGROUND,
      )
      return
    }
    permissionDone = null
    permissionActivity = null
    onDone(engine.permissionStatus())
  }

  private fun findActivityFromPermissions(): Activity? = permissionActivity

  companion object {
    const val REQUEST_FOREGROUND = 0x4859
    const val REQUEST_BACKGROUND = 0x485A
  }
}
