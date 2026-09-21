package com.harshy.engine

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.hardware.TriggerEvent
import android.hardware.TriggerEventListener
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.location.LocationRequest
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import androidx.core.content.ContextCompat
import java.util.ArrayDeque
import java.util.Collections
import java.util.UUID

/**
 * Standalone driving-sensor engine. Host apps (including non-React Native)
 * can construct this with an application [Context] and collect GPS + IMU.
 *
 * On Android the in-progress trip is journaled to disk and the location FGS
 * restores capture if the process is killed mid-drive.
 */
class HarshyEngine(private val context: Context) : SensorEventListener, LocationListener {
  interface Listener {
    fun onLocation(sample: Map<String, Any?>)
    fun onImuBatch(samples: List<Map<String, Any?>>)
    fun onState(state: Map<String, Any?>)
    fun onError(error: Map<String, Any?>)
    fun onWatchFix(sample: Map<String, Any?>) {}
  }

  @Volatile var listener: Listener? = null

  private val sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
  private val locationManager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
  private val journal = TripJournal(context)

  private val accelerometer = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
  private val linearAcceleration = sensorManager.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION)
  private val gyroscope = sensorManager.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
  private val magnetometer = sensorManager.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD)
  private val rotationVector = sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
  private val gravitySensor = sensorManager.getDefaultSensor(Sensor.TYPE_GRAVITY)
  private val pressure = sensorManager.getDefaultSensor(Sensor.TYPE_PRESSURE)
  private val stepDetector = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_DETECTOR)
  private val significantMotion = sensorManager.getDefaultSensor(Sensor.TYPE_SIGNIFICANT_MOTION)

  private val locationSamples = ArrayDeque<Map<String, Any?>>()
  private val imuSamples = ArrayDeque<Map<String, Any?>>()
  private val locationLock = Any()
  private val imuLock = Any()
  private val imuBatch = Collections.synchronizedList(mutableListOf<Map<String, Any?>>())
  private val idleGate = TripIdleGate()

  @Volatile private var running = false
  @Volatile private var previewing = false
  @Volatile private var watching = false
  @Volatile private var lastStepAtMs: Long? = null
  private var significantListener: TriggerEventListener? = null

  private val watchLocationListener = object : LocationListener {
    override fun onLocationChanged(location: Location) {
      emitWatchFix(location)
    }

    @Deprecated("Deprecated in Android")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit

    override fun onProviderEnabled(provider: String) = Unit

    override fun onProviderDisabled(provider: String) = Unit
  }
  private var sessionId: String? = null
  private var startedAtMs: Long = 0
  private var imuHz = 25
  private var locationIntervalMs = 500L
  private var background = true
  private var tripTrigger: String = "manual"
  @Volatile private var vehicleIdle = false
  @Volatile private var lastGpsFixAtMs: Long? = null

  private var lastAccel: FloatArray? = null
  private var lastLinear: FloatArray? = null
  private var lastGyro: FloatArray? = null
  private var lastMag: FloatArray? = null
  private var lastRotation: FloatArray? = null
  private var lastGravity: FloatArray? = null
  private var lastPressure: Float? = null

  private var samplerThread: HandlerThread? = null
  private var samplerHandler: Handler? = null
  private var journalThread: HandlerThread? = null
  private var journalHandler: Handler? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private val lifecycleLock = Any()

  private val sampleRunnable = object : Runnable {
    override fun run() {
      if (!running && !previewing) {
        return
      }
      captureImu()
      val delay = (1000L / imuHz).coerceAtLeast(8L)
      samplerHandler?.postDelayed(this, delay)
    }
  }

  fun isRunning(): Boolean = running

  fun isPreviewing(): Boolean = previewing

  fun capabilities(): Map<String, Any> {
    val fine = hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)
    return mapOf(
      "location" to (fine && locationManager.allProviders.isNotEmpty()),
      "accelerometer" to (accelerometer != null),
      "linearAcceleration" to (linearAcceleration != null),
      "gyroscope" to (gyroscope != null),
      "magnetometer" to (magnetometer != null),
      "barometer" to (pressure != null),
      "attitude" to (rotationVector != null),
      "backgroundLocation" to (
        fine &&
          (Build.VERSION.SDK_INT < 29 || hasPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION))
        ),
    )
  }

  fun permissionStatus(): Map<String, String> {
    val locationGranted = hasPermission(Manifest.permission.ACCESS_FINE_LOCATION) ||
      hasPermission(Manifest.permission.ACCESS_COARSE_LOCATION)
    val backgroundGranted = if (Build.VERSION.SDK_INT < 29) {
      locationGranted
    } else {
      hasPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
    }
    val notificationsGranted = if (Build.VERSION.SDK_INT < 33) {
      true
    } else {
      hasPermission(Manifest.permission.POST_NOTIFICATIONS)
    }
    val motionGranted = if (Build.VERSION.SDK_INT < 29) {
      true
    } else {
      hasPermission(Manifest.permission.ACTIVITY_RECOGNITION)
    }
    return mapOf(
      "location" to if (locationGranted) "granted" else "denied",
      "backgroundLocation" to if (backgroundGranted) "granted" else "denied",
      "motion" to if (motionGranted) "granted" else "denied",
      "notifications" to if (notificationsGranted) "granted" else "denied",
    )
  }

  fun start(options: Map<String, Any?>) {
    synchronized(lifecycleLock) {
      disarmWatchLocked()
      if (running) {
        startLocation()
        emitRunning()
        return
      }
      imuHz = (options["imuHz"] as? Number)?.toInt()?.coerceIn(5, 100) ?: 25
      locationIntervalMs = (options["locationIntervalMs"] as? Number)?.toLong()?.coerceIn(200, 5000) ?: 500L
      background = options["background"] as? Boolean ?: true
      tripTrigger = parseTripTrigger(options["trigger"] as? String)

      if (!hasPermission(Manifest.permission.ACCESS_FINE_LOCATION) &&
        !hasPermission(Manifest.permission.ACCESS_COARSE_LOCATION)
      ) {
        throw SecurityException("Location permission is required")
      }

      sessionId = UUID.randomUUID().toString()
      startedAtMs = System.currentTimeMillis()
      synchronized(locationLock) { locationSamples.clear() }
      synchronized(imuLock) { imuSamples.clear() }
      imuBatch.clear()
      idleGate.reset()
      vehicleIdle = false
      lastGpsFixAtMs = null
      journal.begin(
        TripJournal.Meta(
          sessionId = sessionId!!,
          startedAtMs = startedAtMs,
          imuHz = imuHz,
          locationIntervalMs = locationIntervalMs,
          background = background,
          trigger = tripTrigger,
        ),
      )
      if (previewing) {
        previewing = false
        running = true
        openJournalThread()
        acquireWakeLock()
        if (background) {
          startForeground()
        }
        startLocation()
        emitRunning()
        return
      }
      beginCapture(startService = background)
      emitRunning()
    }
  }

  /**
   * Foreground GPS+IMU for a live readout. Not a trip: no journal, FGS, wake lock,
   * or `running`. Does not disarm the motion watch. No-op while a trip or preview
   * is already capturing.
   */
  fun startPreview(options: Map<String, Any?> = emptyMap()) {
    synchronized(lifecycleLock) {
      if (running || previewing) {
        return
      }
      imuHz = (options["imuHz"] as? Number)?.toInt()?.coerceIn(5, 100) ?: 50
      locationIntervalMs = (options["locationIntervalMs"] as? Number)?.toLong()?.coerceIn(200, 5000) ?: 500L
      if (!hasPermission(Manifest.permission.ACCESS_FINE_LOCATION) &&
        !hasPermission(Manifest.permission.ACCESS_COARSE_LOCATION)
      ) {
        throw SecurityException("Location permission is required")
      }
      previewing = true
      lastGpsFixAtMs = null
      beginPreviewHardware()
    }
  }

  /** Stop a foreground sensor readout. No-op during a trip. Leaves an armed watch in place. */
  fun stopPreview() {
    synchronized(lifecycleLock) {
      if (!previewing) {
        return
      }
      previewing = false
      if (running) {
        return
      }
      lastGpsFixAtMs = null
      stopPreviewHardwareLocked()
    }
  }

  /**
   * Resume a journaled trip after the process was killed. Safe to call often:
   * no-ops when already capturing or when there is no active journal.
   *
   * @param fromService true when [TripForegroundService] is already in the foreground
   */
  fun restoreIfNeeded(fromService: Boolean = false): Boolean {
    synchronized(lifecycleLock) {
      if (running) {
        return true
      }
      val meta = journal.loadMeta() ?: return false
      previewing = false
      disarmWatchLocked()
      if (!hasPermission(Manifest.permission.ACCESS_FINE_LOCATION) &&
        !hasPermission(Manifest.permission.ACCESS_COARSE_LOCATION)
      ) {
        journal.clear()
        return false
      }
      sessionId = meta.sessionId
      startedAtMs = meta.startedAtMs
      imuHz = meta.imuHz.coerceIn(5, 100)
      locationIntervalMs = meta.locationIntervalMs.coerceIn(200, 5000)
      background = meta.background
      tripTrigger = parseTripTrigger(meta.trigger)
      synchronized(locationLock) { locationSamples.clear() }
      synchronized(imuLock) { imuSamples.clear() }
      imuBatch.clear()
      idleGate.reset()
      vehicleIdle = false
      lastGpsFixAtMs = null
      try {
        val restoredLoc = journal.loadLocation(TripIdleGate.MAX_LOCATION_SAMPLES)
        synchronized(locationLock) {
          locationSamples.addAll(restoredLoc)
          capLocation()
        }
      } catch (_: Throwable) {
        journal.clear()
        return false
      }
      journal.resumeWriters()
      beginCapture(startService = background && !fromService)
      journalHandler?.post {
        if (!running) {
          return@post
        }
        try {
          // Tail-only, short window — full 2 h IMU restore can OOM after a long trip crash.
          val restoreMax =
            minOf(TripIdleGate.maxImuSamples(imuHz), imuHz.coerceAtLeast(1) * 60 * 2)
          val restored = journal.loadImu(restoreMax)
          synchronized(imuLock) {
            for (sample in restored.asReversed()) {
              imuSamples.addFirst(sample)
            }
            capImu()
          }
        } catch (_: Throwable) {
          // Keep the trip alive on GPS alone; drop sticky IMU so recover cannot OOM-loop.
          journal.trimImu(0)
        }
      }
      emitRunning()
      return true
    }
  }

  fun stop(includeImu: Boolean = false): Map<String, Any?> {
    synchronized(lifecycleLock) {
      running = false
      lastGpsFixAtMs = null
      samplerHandler?.removeCallbacks(sampleRunnable)
      samplerThread?.quitSafely()
      samplerThread = null
      samplerHandler = null
      journal.flush()
      journalHandler?.removeCallbacksAndMessages(null)
      journalThread?.quitSafely()
      journalThread = null
      journalHandler = null
      sensorManager.unregisterListener(this)
      try {
        locationManager.removeUpdates(this)
      } catch (_: Exception) {
      }
      releaseWakeLock()
      stopForeground()
      flushImuBatch()
      journal.clear()

      val endedAtMs = System.currentTimeMillis()
      val snapshot = snapshot(endedAtMs, includeImu)
      listener?.onState(
        mapOf(
          "running" to false,
          "sessionId" to sessionId,
          "startedAtMs" to startedAtMs,
          "endedAtMs" to endedAtMs,
          "source" to "native",
        ),
      )
      return snapshot
    }
  }

  /**
   * Sparse OS watch for automatic trips. Must not start FGS, IMU, or the journal.
   * No-op while a trip is running. Throws if Always / background location is missing.
   */
  fun armWatch() {
    synchronized(lifecycleLock) {
      if (running) {
        return
      }
      if (watching) {
        return
      }
      val locationGranted = hasPermission(Manifest.permission.ACCESS_FINE_LOCATION) ||
        hasPermission(Manifest.permission.ACCESS_COARSE_LOCATION)
      if (!locationGranted) {
        throw SecurityException("Location permission is required for automatic trips")
      }
      val backgroundGranted = if (Build.VERSION.SDK_INT < 29) {
        locationGranted
      } else {
        hasPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
      }
      if (!backgroundGranted) {
        throw SecurityException("Background location is required for automatic trips")
      }
      watching = true
      lastStepAtMs = null
      startWatchLocked()
    }
  }

  fun disarmWatch() {
    synchronized(lifecycleLock) {
      disarmWatchLocked()
    }
  }

  fun isWatching(): Boolean = watching

  fun snapshot(
    endedAtMs: Long = System.currentTimeMillis(),
    includeImu: Boolean = true,
  ): Map<String, Any?> {
    return mapOf(
      "sessionId" to sessionId,
      "startedAtMs" to startedAtMs,
      "endedAtMs" to endedAtMs,
      "running" to running,
      "trigger" to tripTrigger,
      "location" to synchronized(locationLock) { locationSamples.toList() },
      "imu" to if (includeImu) {
        synchronized(imuLock) { imuSamples.toList() }
      } else {
        emptyList()
      },
      "capabilities" to capabilities(),
    )
  }

  @SuppressLint("MissingPermission")
  private fun startWatchLocked() {
    // Caller holds lifecycleLock. Sparse GPS + fused/network backup + significant-motion.
    lastGpsFixAtMs = null
    requestLocationProvider(
      LocationManager.GPS_PROVIDER,
      WatchFixMaps.WATCH_MIN_TIME_MS,
      WatchFixMaps.WATCH_MIN_DISTANCE_M,
      watchLocationListener,
    )
    fusedProvider()?.let {
      requestLocationProvider(
        it,
        WatchFixMaps.WATCH_MIN_TIME_MS,
        WatchFixMaps.WATCH_MIN_DISTANCE_M,
        watchLocationListener,
      )
    }
    requestLocationProvider(
      LocationManager.NETWORK_PROVIDER,
      WatchFixMaps.WATCH_MIN_TIME_MS,
      WatchFixMaps.WATCH_MIN_DISTANCE_M,
      watchLocationListener,
    )
    requestLocationProvider(
      LocationManager.PASSIVE_PROVIDER,
      WatchFixMaps.WATCH_MIN_TIME_MS,
      WatchFixMaps.WATCH_MIN_DISTANCE_M,
      watchLocationListener,
    )
    emitLastKnownWatchFix()
    stepDetector?.let {
      sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL)
    }
    armSignificantMotionLocked()
  }

  private fun disarmWatchLocked() {
    if (!watching) {
      return
    }
    watching = false
    lastStepAtMs = null
    lastGpsFixAtMs = null
    try {
      locationManager.removeUpdates(watchLocationListener)
    } catch (_: Exception) {
    }
    val trigger = significantListener
    val motionSensor = significantMotion
    if (trigger != null && motionSensor != null) {
      sensorManager.cancelTriggerSensor(trigger, motionSensor)
    }
    significantListener = null
    stepDetector?.let { sensorManager.unregisterListener(this, it) }
  }

  private fun armSignificantMotionLocked() {
    val sensor = significantMotion ?: return
    significantListener?.let { sensorManager.cancelTriggerSensor(it, sensor) }
    val listener = object : TriggerEventListener() {
      override fun onTrigger(event: TriggerEvent) {
        if (!watching || running) {
          return
        }
        requestWatchSingleFix()
        synchronized(lifecycleLock) {
          if (watching && !running) {
            armSignificantMotionLocked()
          }
        }
      }
    }
    significantListener = listener
    sensorManager.requestTriggerSensor(listener, sensor)
  }

  @SuppressLint("MissingPermission")
  private fun requestWatchSingleFix() {
    try {
      requestSingleUpdate(LocationManager.GPS_PROVIDER, watchLocationListener)
      fusedProvider()?.let { requestSingleUpdate(it, watchLocationListener) }
      requestSingleUpdate(LocationManager.NETWORK_PROVIDER, watchLocationListener)
    } catch (_: Exception) {
    }
  }

  private fun emitWatchFix(location: Location) {
    if (!watching || running) {
      return
    }
    val nowMs = System.currentTimeMillis()
    if (!shouldTakeFix(location, nowMs)) {
      return
    }
    if (usableGnssLock(location)) {
      lastGpsFixAtMs = nowMs
    }
    val activity = WatchFixMaps.activityFromSteps(
      nowMs,
      lastStepAtMs,
      if (location.hasSpeed()) location.speed.toDouble() else null,
    )
    listener?.onWatchFix(WatchFixMaps.fromLocation(location, activity, nowMs))
  }

  private fun beginCapture(startService: Boolean) {
    // Caller holds lifecycleLock.
    if (samplerThread != null) {
      samplerHandler?.removeCallbacks(sampleRunnable)
      samplerThread?.quitSafely()
      samplerThread = null
      samplerHandler = null
    }
    running = true
    openJournalThread()
    acquireWakeLock()
    registerSensors()
    if (startService) {
      startForeground()
    }
    startLocation()
    val thread = HandlerThread("harshy-imu")
    thread.start()
    samplerThread = thread
    samplerHandler = Handler(thread.looper)
    samplerHandler?.post(sampleRunnable)
  }

  private fun beginPreviewHardware() {
    // Caller holds lifecycleLock. Same GPS+IMU as a trip, without journal / FGS / wake.
    if (samplerThread != null) {
      samplerHandler?.removeCallbacks(sampleRunnable)
      samplerThread?.quitSafely()
      samplerThread = null
      samplerHandler = null
    }
    registerSensors()
    startLocation()
    val thread = HandlerThread("harshy-imu")
    thread.start()
    samplerThread = thread
    samplerHandler = Handler(thread.looper)
    samplerHandler?.post(sampleRunnable)
  }

  private fun stopPreviewHardwareLocked() {
    samplerHandler?.removeCallbacks(sampleRunnable)
    samplerThread?.quitSafely()
    samplerThread = null
    samplerHandler = null
    unregisterTripSensors()
    try {
      locationManager.removeUpdates(this)
    } catch (_: Exception) {
    }
    flushImuBatch()
  }

  private fun unregisterTripSensors() {
    accelerometer?.let { sensorManager.unregisterListener(this, it) }
    linearAcceleration?.let { sensorManager.unregisterListener(this, it) }
    gyroscope?.let { sensorManager.unregisterListener(this, it) }
    magnetometer?.let { sensorManager.unregisterListener(this, it) }
    rotationVector?.let { sensorManager.unregisterListener(this, it) }
    gravitySensor?.let { sensorManager.unregisterListener(this, it) }
    pressure?.let { sensorManager.unregisterListener(this, it) }
  }

  private fun emitRunning() {
    listener?.onState(
      mapOf(
        "running" to true,
        "sessionId" to sessionId,
        "startedAtMs" to startedAtMs,
        "source" to "native",
      ),
    )
  }

  private fun hasPermission(permission: String): Boolean {
    return ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
  }

  private fun registerSensors() {
    val delay = SensorManager.SENSOR_DELAY_GAME
    accelerometer?.let { sensorManager.registerListener(this, it, delay) }
    linearAcceleration?.let { sensorManager.registerListener(this, it, delay) }
    gyroscope?.let { sensorManager.registerListener(this, it, delay) }
    magnetometer?.let { sensorManager.registerListener(this, it, delay) }
    rotationVector?.let { sensorManager.registerListener(this, it, delay) }
    gravitySensor?.let { sensorManager.registerListener(this, it, delay) }
    pressure?.let { sensorManager.registerListener(this, it, delay) }
  }

  @SuppressLint("MissingPermission")
  private fun startLocation() {
    val minTime = locationIntervalMs
    requestLocationProvider(LocationManager.GPS_PROVIDER, minTime, 0f, this)
    fusedProvider()?.let { requestLocationProvider(it, minTime, 0f, this) }
    requestLocationProvider(LocationManager.NETWORK_PROVIDER, minTime, 0f, this)
    emitLastKnownTripFix()
  }

  private fun fusedProvider(): String? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
      return null
    }
    return LocationManager.FUSED_PROVIDER
  }

  private fun gpsProviderEnabled(): Boolean {
    return try {
      locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)
    } catch (_: Exception) {
      false
    }
  }

  @SuppressLint("MissingPermission")
  private fun requestLocationProvider(
    provider: String,
    minTime: Long,
    minDistance: Float,
    listener: LocationListener,
  ) {
    try {
      if (
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
        provider == LocationManager.FUSED_PROVIDER
      ) {
        val request = LocationRequest.Builder(minTime)
          .setMinUpdateIntervalMillis(minTime)
          .setMinUpdateDistanceMeters(minDistance)
          .setQuality(LocationRequest.QUALITY_HIGH_ACCURACY)
          .build()
        locationManager.requestLocationUpdates(
          LocationManager.FUSED_PROVIDER,
          request,
          context.mainExecutor,
          listener,
        )
        return
      }
      locationManager.requestLocationUpdates(
        provider,
        minTime,
        minDistance,
        listener,
        Looper.getMainLooper(),
      )
    } catch (_: SecurityException) {
    } catch (_: IllegalArgumentException) {
    } catch (_: Exception) {
    }
  }

  @SuppressLint("MissingPermission")
  private fun requestSingleUpdate(provider: String, listener: LocationListener) {
    try {
      locationManager.requestSingleUpdate(provider, listener, Looper.getMainLooper())
    } catch (_: Exception) {
    }
  }

  private fun usableGnssLock(location: Location): Boolean {
    return LocationFallback.isUsableGnssFix(
      location.provider,
      if (location.hasAccuracy()) location.accuracy else null,
      location.hasSpeed(),
    )
  }

  private fun shouldTakeFix(location: Location, nowMs: Long): Boolean {
    return LocationFallback.shouldAcceptFix(
      location.provider,
      nowMs,
      lastGpsFixAtMs,
      gpsProviderEnabled(),
      accuracyM = if (location.hasAccuracy()) location.accuracy else null,
      hasSpeed = location.hasSpeed(),
      dropSearchingGps = fusedProvider() != null,
    )
  }

  private fun isFreshLastKnown(location: Location): Boolean {
    return LocationFallback.isFreshFix(
      location.elapsedRealtimeNanos,
      SystemClock.elapsedRealtimeNanos(),
      location.time,
      System.currentTimeMillis(),
    )
  }

  @SuppressLint("MissingPermission")
  private fun emitLastKnownWatchFix() {
    emitLastKnownFix { emitWatchFix(it) }
  }

  @SuppressLint("MissingPermission")
  private fun emitLastKnownTripFix() {
    if (!running && !previewing) {
      return
    }
    emitLastKnownFix { onLocationChanged(it) }
  }

  @SuppressLint("MissingPermission")
  private fun emitLastKnownFix(emit: (Location) -> Unit) {
    val order = listOfNotNull(
      LocationManager.GPS_PROVIDER,
      fusedProvider(),
      LocationManager.NETWORK_PROVIDER,
    )
    var fallback: Location? = null
    for (provider in order) {
      val location = try {
        locationManager.getLastKnownLocation(provider)
      } catch (_: Exception) {
        null
      } ?: continue
      if (!isFreshLastKnown(location)) {
        continue
      }
      if (LocationFallback.isGps(location.provider) && !usableGnssLock(location)) {
        continue
      }
      if (usableGnssLock(location)) {
        emit(location)
        return
      }
      if (fallback == null) {
        fallback = location
      }
    }
    fallback?.let(emit)
  }

  private fun startForeground() {
    try {
      val intent = Intent(context, TripForegroundService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    } catch (error: Exception) {
      listener?.onError(
        mapOf(
          "code" to "foreground_service",
          "message" to (error.message ?: "Could not start background recording"),
        ),
      )
    }
  }

  private fun stopForeground() {
    try {
      context.stopService(Intent(context, TripForegroundService::class.java))
    } catch (_: Exception) {
    }
  }

  private fun openJournalThread() {
    if (journalHandler != null) {
      return
    }
    val thread = HandlerThread("harshy-journal")
    thread.start()
    journalThread = thread
    journalHandler = Handler(thread.looper)
  }

  @SuppressLint("WakelockTimeout")
  private fun acquireWakeLock() {
    if (wakeLock?.isHeld == true) {
      return
    }
    val manager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock = manager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "harshy:trip").apply {
      setReferenceCounted(false)
      acquire()
    }
  }

  private fun releaseWakeLock() {
    try {
      if (wakeLock?.isHeld == true) {
        wakeLock?.release()
      }
    } catch (_: Exception) {
    }
    wakeLock = null
  }

  override fun onSensorChanged(event: SensorEvent) {
    if (event.sensor.type == Sensor.TYPE_STEP_DETECTOR) {
      if (watching && !running) {
        lastStepAtMs = System.currentTimeMillis()
      }
      return
    }
    when (event.sensor.type) {
      Sensor.TYPE_ACCELEROMETER -> lastAccel = event.values.clone()
      Sensor.TYPE_LINEAR_ACCELERATION -> lastLinear = event.values.clone()
      Sensor.TYPE_GYROSCOPE -> lastGyro = event.values.clone()
      Sensor.TYPE_MAGNETIC_FIELD -> lastMag = event.values.clone()
      Sensor.TYPE_ROTATION_VECTOR -> lastRotation = event.values.clone()
      Sensor.TYPE_GRAVITY -> lastGravity = event.values.clone()
      Sensor.TYPE_PRESSURE -> lastPressure = event.values[0]
    }
  }

  override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

  override fun onLocationChanged(location: Location) {
    if (!running && !previewing) {
      return
    }
    val nowMs = System.currentTimeMillis()
    if (!shouldTakeFix(location, nowMs)) {
      return
    }
    if (usableGnssLock(location)) {
      lastGpsFixAtMs = nowMs
    }
    if (previewing && !running) {
      listener?.onLocation(location.toSampleMap())
      return
    }
    val raw = location.toSampleMap()
    val tMs = (raw["t"] as? Number)?.toLong() ?: System.currentTimeMillis()
    val speed = raw["speedMps"] as? Double
    val idle = idleGate.advance(tMs, speed)
    vehicleIdle = idle
    if (idle) {
      val lat = raw["lat"] as? Double ?: return
      val lon = raw["lon"] as? Double ?: return
      if (!idleGate.shouldKeepIdleLocation(tMs, lat, lon)) {
        return
      }
    }
    // Stamp road on-device so Expo stop (no IMU bridge) still keeps History Road mode.
    val sample = synchronized(imuLock) {
      RoadStamp.withRoadRms(raw, startedAtMs, imuSamples)
    }
    var trimmed = false
    synchronized(locationLock) {
      locationSamples.addLast(sample)
      val before = locationSamples.size
      capLocation()
      trimmed = locationSamples.size < before
    }
    persist {
      journal.appendLocation(sample)
      if (trimmed) {
        journal.trimLocation(TripIdleGate.MAX_LOCATION_SAMPLES)
      }
    }
    listener?.onLocation(sample)
  }

  @Deprecated("Deprecated in Android")
  override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit

  override fun onProviderEnabled(provider: String) = Unit

  override fun onProviderDisabled(provider: String) = Unit

  private fun captureImu() {
    if (!running && !previewing) {
      return
    }
    if (running && (vehicleIdle || idleGate.isIdle())) {
      return
    }
    val accel = lastAccel ?: return
    val attitude = attitudeFromRotation(lastRotation)
    val sample = mapOf(
      "t" to System.currentTimeMillis(),
      "accel" to accel.toVec(),
      "linearAccel" to lastLinear?.toVec(),
      "gyro" to lastGyro?.toVec(),
      "magnetometer" to lastMag?.toVec(),
      "attitude" to attitude,
      "gravity" to lastGravity?.toVec(),
      "barometerHpa" to lastPressure?.toDouble(),
    )
    var trimmed = false
    if (running) {
      synchronized(imuLock) {
        imuSamples.addLast(sample)
        val before = imuSamples.size
        capImu()
        trimmed = imuSamples.size < before
      }
      persist {
        journal.appendImu(sample)
        if (trimmed) {
          journal.trimImu(TripIdleGate.maxImuSamples(imuHz))
        }
      }
    }
    val ready: List<Map<String, Any?>>
    synchronized(imuBatch) {
      imuBatch.add(sample)
      if (imuBatch.size >= (imuHz / 5).coerceAtLeast(2)) {
        ready = imuBatch.toList()
        imuBatch.clear()
      } else {
        ready = emptyList()
      }
    }
    if (ready.isNotEmpty()) {
      listener?.onImuBatch(ready)
    }
  }

  private fun persist(write: () -> Unit) {
    val handler = journalHandler
    if (handler == null) {
      write()
      return
    }
    handler.post(write)
  }

  private fun capLocation() {
    val max = TripIdleGate.MAX_LOCATION_SAMPLES
    if (locationSamples.size <= max) {
      return
    }
    val target = TripIdleGate.ringTarget(max)
    while (locationSamples.size > target) {
      locationSamples.removeFirst()
    }
  }

  private fun capImu() {
    val max = TripIdleGate.maxImuSamples(imuHz)
    if (imuSamples.size <= max) {
      return
    }
    val target = TripIdleGate.ringTarget(max)
    while (imuSamples.size > target) {
      imuSamples.removeFirst()
    }
  }

  private fun flushImuBatch() {
    val ready: List<Map<String, Any?>>
    synchronized(imuBatch) {
      ready = imuBatch.toList()
      imuBatch.clear()
    }
    if (ready.isNotEmpty()) {
      listener?.onImuBatch(ready)
    }
  }

  private fun attitudeFromRotation(rotation: FloatArray?): Map<String, Double>? {
    if (rotation == null || rotation.isEmpty()) {
      return null
    }
    return try {
      val matrix = FloatArray(9)
      val orientation = FloatArray(3)
      SensorManager.getRotationMatrixFromVector(matrix, rotation)
      SensorManager.getOrientation(matrix, orientation)
      mapOf(
        "yaw" to orientation[0].toDouble(),
        "pitch" to orientation[1].toDouble(),
        "roll" to orientation[2].toDouble(),
      )
    } catch (_: Exception) {
      // Some OEMs throw on short / malformed rotation vectors.
      null
    }
  }

  companion object {
    @Volatile private var instance: HarshyEngine? = null

    @JvmStatic
    fun shared(context: Context): HarshyEngine {
      val existing = instance
      if (existing != null) {
        return existing
      }
      synchronized(this) {
        val again = instance
        if (again != null) {
          return again
        }
        val created = HarshyEngine(context.applicationContext)
        instance = created
        return created
      }
    }
  }
}

private fun FloatArray.toVec(): Map<String, Double> {
  return mapOf(
    "x" to this[0].toDouble(),
    "y" to (if (size > 1) this[1].toDouble() else 0.0),
    "z" to (if (size > 2) this[2].toDouble() else 0.0),
  )
}

private fun Location.toSampleMap(): Map<String, Any?> {
  // Wall clock — must match IMU `System.currentTimeMillis()` so road RMS windows align.
  // GNSS `time` can drift from the sensor clock and leave every `roadRmsMps2` null.
  return mapOf(
    "t" to System.currentTimeMillis(),
    "lat" to latitude,
    "lon" to longitude,
    "altitudeM" to altitude,
    "speedMps" to if (hasSpeed()) speed.toDouble() else null,
    "courseDeg" to if (hasBearing()) bearing.toDouble() else null,
    "accuracyM" to if (hasAccuracy()) accuracy.toDouble() else null,
    "altitudeAccuracyM" to if (Build.VERSION.SDK_INT >= 26 && hasVerticalAccuracy()) {
      verticalAccuracyMeters.toDouble()
    } else {
      null
    },
  )
}
