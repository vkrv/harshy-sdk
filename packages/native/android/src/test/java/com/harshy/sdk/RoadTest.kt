package com.harshy.sdk

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RoadTest {
  private val gravityUp = Vec3(0.0, 0.0, 9.81)

  private fun loc(t: Double, speedMps: Double, roadRmsMps2: Double? = null): LocationSample {
    return LocationSample(
      t = t,
      lat = 32.0,
      lon = 34.0,
      speedMps = speedMps,
      courseDeg = 0.0,
      accuracyM = 5.0,
      roadRmsMps2 = roadRmsMps2,
    )
  }

  private fun imu(t: Double, z: Double): ImuSample {
    return ImuSample(
      t = t,
      accel = Vec3(0.0, 0.0, z + 9.81),
      linearAccel = Vec3(0.0, 0.0, z),
      gravity = gravityUp,
    )
  }

  @Test
  fun fillsRoadRmsFromImuWindow() {
    val started = 1_000.0
    val t = started + 4_000.0
    val assessed = assessRoad(
      location = listOf(loc(t, 10.0)),
      imu = listOf(imu(t - 800.0, 2.0), imu(t - 400.0, 2.0), imu(t, 2.0)),
      startedAtMs = started,
      jerkSettleMs = 1_500.0,
      minSpeedMps = 2.0,
    )
    assertEquals(2.0, assessed[0].roadRmsMps2!!, 1e-6)
  }

  @Test
  fun keepsNativeStampedRoadWhenImuEmpty() {
    val assessed = assessRoad(
      location = listOf(loc(5_000.0, 12.0, 1.75)),
      imu = emptyList(),
      startedAtMs = 1_000.0,
      jerkSettleMs = 1_500.0,
      minSpeedMps = 2.0,
    )
    assertEquals(1.75, assessed[0].roadRmsMps2!!, 1e-9)
  }

  @Test
  fun preservesExistingRoadWhenImuPresent() {
    val t = 5_000.0
    val assessed = assessRoad(
      location = listOf(loc(t, 12.0, 1.1)),
      imu = listOf(imu(t - 200.0, 4.0), imu(t, 4.0)),
      startedAtMs = 1_000.0,
      jerkSettleMs = 1_500.0,
      minSpeedMps = 2.0,
    )
    assertEquals(1.1, assessed[0].roadRmsMps2!!, 1e-9)
  }

  @Test
  fun skipsSettleAndIdle() {
    val started = 1_000.0
    val assessed = assessRoad(
      location = listOf(
        loc(started + 400.0, 12.0),
        loc(started + 3_000.0, 0.5),
        loc(started + 4_000.0, 10.0),
      ),
      imu = listOf(
        imu(started + 300.0, 5.0),
        imu(started + 2_800.0, 5.0),
        imu(started + 3_500.0, 2.0),
        imu(started + 4_000.0, 2.0),
      ),
      startedAtMs = started,
      jerkSettleMs = 1_500.0,
      minSpeedMps = 2.0,
    )
    assertNull(assessed[0].roadRmsMps2)
    assertNull(assessed[1].roadRmsMps2)
    assertEquals(2.0, assessed[2].roadRmsMps2!!, 1e-6)
  }
}
