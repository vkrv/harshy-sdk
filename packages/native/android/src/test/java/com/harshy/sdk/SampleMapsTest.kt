package com.harshy.sdk

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class SampleMapsTest {
  @Test
  fun parsesLocationWithNumericTypes() {
    val sample = parseLocationSample(
      mapOf(
        "t" to 1_500L,
        "lat" to 59.437f,
        "lon" to 24,
        "speedMps" to "8.5",
        "accuracyM" to 5,
        "roadRmsMps2" to 1.25,
      ),
    )
    assertNotNull(sample)
    assertEquals(1500.0, sample!!.t, 0.001)
    assertEquals(24.0, sample.lon, 0.001)
    assertEquals(8.5, sample.speedMps!!, 0.001)
    assertEquals(1.25, sample.roadRmsMps2!!, 1e-9)
  }

  @Test
  fun dropsLocationWithoutCoordinates() {
    assertNull(parseLocationSample(mapOf("t" to 1.0, "lat" to 59.0)))
    assertNull(parseLocationSample(mapOf("lat" to 59.0, "lon" to 24.0)))
  }

  @Test
  fun parsesImuAccelAndOptionalGyro() {
    val sample = parseImuSample(
      mapOf(
        "t" to 40.0,
        "accel" to mapOf("x" to 0, "y" to 0, "z" to 9.81),
        "gyro" to mapOf("x" to 0.1, "y" to 0.0, "z" to -0.2),
      ),
    )
    assertNotNull(sample)
    assertEquals(9.81, sample!!.accel.z, 0.001)
    assertEquals(-0.2, sample.gyro!!.z, 0.001)
  }

  @Test
  fun dropsImuWithoutAccel() {
    assertNull(parseImuSample(mapOf("t" to 1.0, "gyro" to mapOf("x" to 1, "y" to 0, "z" to 0))))
  }
}
