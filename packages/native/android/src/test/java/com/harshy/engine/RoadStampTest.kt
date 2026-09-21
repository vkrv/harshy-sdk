package com.harshy.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.ArrayDeque

class RoadStampTest {
  @Test
  fun stampsRmsFromRecentImuWindow() {
    val started = 1_000_000L
    val t = started + 5_000L
    val imu = ArrayDeque<Map<String, Any?>>()
    for (i in 0 until 20) {
      imu.addLast(
        mapOf(
          "t" to (t - 800 + i * 40),
          "accel" to mapOf("x" to 0.0, "y" to 0.0, "z" to 9.8),
          "linearAccel" to mapOf("x" to 0.0, "y" to 0.0, "z" to 2.0),
          "gravity" to mapOf("x" to 0.0, "y" to 0.0, "z" to 9.8),
        ),
      )
    }
    val sample = mapOf<String, Any?>(
      "t" to t,
      "lat" to 59.0,
      "lon" to 24.0,
      "speedMps" to 10.0,
    )
    val stamped = RoadStamp.withRoadRms(sample, started, imu)
    assertNotNull(stamped["roadRmsMps2"])
    assertEquals(2.0, stamped["roadRmsMps2"] as Double, 1e-6)
  }

  @Test
  fun skipsIdleAndSettle() {
    val started = 1_000_000L
    val imu = ArrayDeque<Map<String, Any?>>()
    imu.addLast(
      mapOf(
        "t" to started + 200L,
        "accel" to mapOf("x" to 0.0, "y" to 0.0, "z" to 9.8),
        "linearAccel" to mapOf("x" to 0.0, "y" to 0.0, "z" to 3.0),
        "gravity" to mapOf("x" to 0.0, "y" to 0.0, "z" to 9.8),
      ),
    )
    val settling = RoadStamp.withRoadRms(
      mapOf("t" to started + 200L, "speedMps" to 10.0),
      started,
      imu,
    )
    assertNull(settling["roadRmsMps2"])

    val idle = RoadStamp.withRoadRms(
      mapOf("t" to started + 5_000L, "speedMps" to 0.5),
      started,
      imu,
    )
    assertNull(idle["roadRmsMps2"])
  }

  @Test
  fun preservesExistingRoadRms() {
    val imu = ArrayDeque<Map<String, Any?>>()
    val sample = mapOf<String, Any?>(
      "t" to 2_000_000L,
      "speedMps" to 10.0,
      "roadRmsMps2" to 1.25,
    )
    val stamped = RoadStamp.withRoadRms(sample, 1_000_000L, imu)
    assertEquals(1.25, stamped["roadRmsMps2"] as Double, 1e-9)
  }

  @Test
  fun ignoresImuOutsideOneSecondWindow() {
    val started = 1_000_000L
    val t = started + 5_000L
    val imu = ArrayDeque<Map<String, Any?>>()
    imu.addLast(
      mapOf(
        "t" to t - 2_000L,
        "linearAccel" to mapOf("x" to 0.0, "y" to 0.0, "z" to 9.0),
        "accel" to mapOf("x" to 0.0, "y" to 0.0, "z" to 18.8),
        "gravity" to mapOf("x" to 0.0, "y" to 0.0, "z" to 9.8),
      ),
    )
    imu.addLast(
      mapOf(
        "t" to t - 200L,
        "linearAccel" to mapOf("x" to 0.0, "y" to 0.0, "z" to 1.5),
        "accel" to mapOf("x" to 0.0, "y" to 0.0, "z" to 11.3),
        "gravity" to mapOf("x" to 0.0, "y" to 0.0, "z" to 9.8),
      ),
    )
    val stamped = RoadStamp.withRoadRms(
      mapOf("t" to t, "speedMps" to 10.0),
      started,
      imu,
    )
    assertEquals(1.5, stamped["roadRmsMps2"] as Double, 1e-6)
  }
}
