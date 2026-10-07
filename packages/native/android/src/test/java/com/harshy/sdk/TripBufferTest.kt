package com.harshy.sdk

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.cos
import kotlin.math.sin

class TripBufferTest {
  private val gravityUp = Vec3(0.0, 0.0, 9.81)

  @Test
  fun ringTrimDropsTheOldestWithoutSlackForSmallCaps() {
    val items = ArrayDeque((1..12).toList())
    trimRingBuffer(items, 10)
    assertEquals((3..12).toList(), items.toList())
  }

  @Test
  fun ringTrimDropsAChunkForLargeCaps() {
    val items = ArrayDeque((1..101).toList())
    trimRingBuffer(items, 100)
    assertEquals(98, items.size)
    assertEquals(4, items.first())
  }

  @Test
  fun defaultImuCapIsTwoHoursAtTheImuRate() {
    assertEquals(25 * 60 * 120, maxImuSamples(25))
    assertEquals(50 * 60 * 120, maxImuSamples(0))
  }

  @Test
  fun analyzerCapsRawImuAtTheOverride() {
    val analyzer = analyzer(maxImuSamples = 50)
    repeat(200) { analyzer.pushImu(imu(it * 40.0)) }
    assertTrue(analyzer.finalize(8_000.0).imu.size <= 50)
  }

  @Test
  fun analyzerDefaultCapFollowsTheCaptureRate() {
    val analyzer = TripAnalyzer(
      configInput = null,
      sessionId = "cap",
      startedAtMs = 0.0,
      device = DeviceInfo("android", "test"),
      capture = NativeStartOptions(imuHz = 1),
    )
    repeat(maxImuSamples(1) + 100) { analyzer.pushImu(imu(it * 1_000.0)) }
    assertTrue(analyzer.finalize().imu.size <= maxImuSamples(1))
  }

  @Test
  fun aShortImuWindowDetectsTheSameTripAsTheFullBuffer() {
    assertShortWindowMatchesFullBuffer(dropSpeedEvery = 0)
  }

  @Test
  fun aShortImuWindowMatchesWhenSomeFixesLackSpeed() {
    assertShortWindowMatchesFullBuffer(dropSpeedEvery = 3)
  }

  private fun assertShortWindowMatchesFullBuffer(dropSpeedEvery: Int) {
    val full = analyzer(maxImuSamples = null)
    val short = analyzer(maxImuSamples = 50)
    streamTrip(dropSpeedEvery) { sample ->
      when (sample) {
        is LocationSample -> {
          full.pushLocation(sample)
          short.pushLocation(sample)
        }
        is ImuSample -> {
          full.pushImu(sample)
          short.pushImu(sample)
        }
      }
    }
    val a = full.finalize(TRIP_MS)
    val b = short.finalize(TRIP_MS)

    assertEquals(a.events.map { listOf(it.type, it.level, it.t, it.endT, it.peak) }, b.events.map { listOf(it.type, it.level, it.t, it.endT, it.peak) })
    assertTrue(a.events.any { it.type == "harsh_brake" })
    assertEquals(a.metrics, b.metrics)
    assertEquals(a.location.map { it.roadRmsMps2 }, b.location.map { it.roadRmsMps2 })
    assertTrue(b.location.count { it.roadRmsMps2 != null } > 50)
    assertTrue(b.imu.size <= 50)
  }

  private fun analyzer(maxImuSamples: Int?): TripAnalyzer = TripAnalyzer(
    configInput = null,
    sessionId = "trip",
    startedAtMs = 0.0,
    device = DeviceInfo("android", "test"),
    imuHz = 25,
    maxImuSamples = maxImuSamples,
  )

  private fun imu(t: Double, verticalLinear: Double = 0.0): ImuSample {
    val linear = Vec3(0.0, 0.0, verticalLinear)
    return ImuSample(
      t = t,
      accel = Vec3(0.0, 0.0, gravityUp.z + verticalLinear),
      linearAccel = linear,
      gravity = gravityUp,
    )
  }

  // 120 s trip: accelerate to 15 m/s, cruise on a bumpy road, brake hard to 7 m/s, cruise.
  private fun streamTrip(dropSpeedEvery: Int, push: (Any) -> Unit) {
    val lat = 32.0
    val metersPerDegLon = 111_320.0 * cos(Math.toRadians(lat))
    var lon = 34.0
    var lastFixT = 0.0
    var speed = 0.0
    var t = 0.0
    while (t <= TRIP_MS) {
      push(imu(t, verticalLinear = 1.5 * sin(t / 90.0)))
      if (t - lastFixT >= 1_000.0 || t == 0.0) {
        val second = (t / 1_000.0).toInt()
        speed = when {
          second < 15 -> second.toDouble()
          second in 60..61 -> speed - 4.0
          else -> speed
        }.coerceAtLeast(0.0)
        lon += speed * ((t - lastFixT) / 1_000.0) / metersPerDegLon
        lastFixT = t
        val reported = if (dropSpeedEvery > 0 && second % dropSpeedEvery == 1) null else speed
        push(LocationSample(t = t, lat = lat, lon = lon, speedMps = reported, courseDeg = 90.0, accuracyM = 4.0))
      }
      t += 40.0
    }
  }

  private companion object {
    const val TRIP_MS = 120_000.0
  }
}
