package com.harshy.sdk

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Runs one [TripAnalyzer] on its own thread for a host that owns location and the process
 * lifecycle: no foreground service, no GPS request, no journal, no permissions of its own.
 *
 * The recorder registers the IMU sensors the detector reads (accelerometer, linear acceleration,
 * gyroscope, gravity) at `capture.imuHz`, samples them at that rate, and thins locations offered
 * through [offerLocation] to `capture.locationIntervalMs`. Every sample is stamped by [clock]; use one
 * recorder, and one clock, per trip. [Listener] callbacks run on the recorder thread; an exception
 * thrown from [Listener.onError] is dropped. The host keeps the process alive while recording, for
 * example with its own foreground service.
 */
class HeadlessTripRecorder(
  context: Context,
  private val sessionId: String,
  private val listener: Listener,
  private val detector: DetectorConfig? = null,
  capture: NativeStartOptions = NativeStartOptions(background = false),
  private val device: DeviceInfo = DeviceInfo(platform = "android", model = Build.MODEL),
  private val trigger: String = "manual",
  /** IMU ring size passed to [TripAnalyzer]; keep it small when raw IMU is not exported. */
  private val maxImuSamples: Int? = null,
  private val clock: HarshyClock = HarshyClock.monotonic(),
) {
  interface Listener {
    fun onStarted(startedAtMs: Long, sensors: List<String>) {}

    fun onPush(push: AnalyzerPush) {}

    /** The finalized session, after [stop] or after an error. */
    fun onFinalized(session: SessionExport) {}

    /** A failure in the detector or a listener. Recording stops and the session is finalized. */
    fun onError(error: Throwable) {}
  }

  private val sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
  // One clamped copy drives the tick, the throttle and the exported settings, so they always agree.
  private val capture = capture.copy(
    imuHz = capture.imuHz.coerceIn(IMU_HZ_RANGE),
    locationIntervalMs = capture.locationIntervalMs.coerceIn(LOCATION_INTERVAL_MS_RANGE),
  )
  private val tickMs = (MILLIS_PER_SECOND / this.capture.imuHz).coerceAtLeast(MIN_TICK_MS)
  private val throttle = LocationThrottle(this.capture.locationIntervalMs)
  private val sensorPeriodUs = (MICROS_PER_SECOND / this.capture.imuHz).toInt()
  private val thread = HandlerThread(THREAD_NAME)
  private val started = AtomicBoolean(false)

  /** Set once by [start]; read by [offerLocation] and [stop] from any thread. */
  @Volatile
  private var handler: Handler? = null
  private var analyzer: TripAnalyzer? = null

  /** Set by [stop]; refuses new work. Work already queued still runs until [shutdown]. */
  @Volatile
  private var stopped = false

  /** Set by [shutdown] on the recorder thread; after it nothing reaches the analyzer or listener. */
  private var finished = false

  private var accel: FloatArray? = null
  private var linearAccel: FloatArray? = null
  private var gyro: FloatArray? = null
  private var gravity: FloatArray? = null

  private val sensorListener = object : SensorEventListener {
    override fun onSensorChanged(event: SensorEvent) {
      val values = event.values.clone()
      when (event.sensor.type) {
        Sensor.TYPE_ACCELEROMETER -> accel = values
        Sensor.TYPE_LINEAR_ACCELERATION -> linearAccel = values
        Sensor.TYPE_GYROSCOPE -> gyro = values
        Sensor.TYPE_GRAVITY -> gravity = values
      }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
  }

  private val tick = object : Runnable {
    override fun run() {
      guarded {
        val sample = imuSampleOf(clock.nowMs(), accel, linearAccel, gyro, gravity)
        val push = sample?.let { analyzer?.pushImu(it) }
        push?.let(listener::onPush)
      }
      if (!stopped) {
        handler?.postDelayed(this, tickMs)
      }
    }
  }

  /** Starts sampling. Call once. */
  fun start() {
    check(started.compareAndSet(false, true)) { "HeadlessTripRecorder already started" }
    thread.start()
    val looper = Handler(thread.looper)
    handler = looper
    // Not `guarded`: a stop() queued right behind start() must still find an analyzer to finalize.
    looper.post {
      try {
        val startedAtMs = clock.nowMs()
        analyzer = TripAnalyzer(
          configInput = detector,
          sessionId = sessionId,
          startedAtMs = startedAtMs.toDouble(),
          device = device,
          trigger = trigger,
          capture = capture,
          imuHz = capture.imuHz,
          maxImuSamples = maxImuSamples,
        )
        val sensors = SENSORS.filter { (type, _) -> sensorManager.getDefaultSensor(type) != null }
        sensors.forEach { (type, _) ->
          sensorManager.registerListener(sensorListener, sensorManager.getDefaultSensor(type), sensorPeriodUs, looper)
        }
        listener.onStarted(startedAtMs, sensors.map { it.second })
        if (!stopped) {
          looper.post(tick)
        }
      } catch (error: Exception) {
        reportError(error)
        if (!stopped) {
          stopped = true
          shutdown()
        }
      }
    }
  }

  /** Offers a platform location fix. Safe from any thread; ignored before [start] and after [stop]. */
  fun offerLocation(location: Location) {
    val looper = handler ?: return
    if (stopped) {
      return
    }
    // Convert on the caller's thread: `Location` is mutable and may be reused after this returns.
    val sample = location.toLocationSample(clock.nowMs())
    looper.post {
      guarded {
        if (throttle.accept(sample.t.toLong())) {
          analyzer?.pushLocation(sample)?.let(listener::onPush)
        }
      }
    }
  }

  /** Stops sampling, finalizes the session on the recorder thread, and ends the thread. */
  fun stop() {
    val looper = handler ?: return
    if (stopped) {
      return
    }
    stopped = true
    looper.post { shutdown() }
  }

  private fun shutdown() {
    if (finished) {
      return
    }
    finished = true
    handler?.removeCallbacks(tick)
    sensorManager.unregisterListener(sensorListener)
    val current = analyzer
    analyzer = null
    if (current != null) {
      try {
        listener.onFinalized(current.finalize(clock.nowMs().toDouble()))
      } catch (error: Exception) {
        reportError(error)
      }
    }
    thread.quitSafely()
  }

  private inline fun guarded(block: () -> Unit) {
    if (finished) {
      return
    }
    try {
      block()
    } catch (error: Exception) {
      stopped = true
      reportError(error)
      shutdown()
    }
  }

  /** An exception thrown here would end the recorder thread and crash the host, so it is dropped. */
  private fun reportError(error: Throwable) {
    try {
      listener.onError(error)
    } catch (_: Exception) {
      // The listener failed while handling a failure; nothing is left to report it to.
    }
  }

  private companion object {
    const val THREAD_NAME = "harshy-headless"
    const val MILLIS_PER_SECOND = 1_000L
    const val MICROS_PER_SECOND = 1_000_000L
    const val MIN_TICK_MS = 8L

    val SENSORS = listOf(
      Sensor.TYPE_ACCELEROMETER to "accel",
      Sensor.TYPE_LINEAR_ACCELERATION to "linear_accel",
      Sensor.TYPE_GYROSCOPE to "gyro",
      Sensor.TYPE_GRAVITY to "gravity",
    )
  }
}
