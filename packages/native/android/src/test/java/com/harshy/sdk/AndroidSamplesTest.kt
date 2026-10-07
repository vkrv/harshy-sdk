package com.harshy.sdk

import android.location.Location
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AndroidSamplesTest {
  private fun location(withOptionalFields: Boolean): Location = object : Location("test") {
    override fun getLatitude(): Double = 59.43
    override fun getLongitude(): Double = 24.75
    override fun getAltitude(): Double = 12.0
    override fun getTime(): Long = 42L
    override fun hasSpeed(): Boolean = withOptionalFields
    override fun getSpeed(): Float = 13.5f
    override fun hasBearing(): Boolean = withOptionalFields
    override fun getBearing(): Float = 90f
    override fun hasAccuracy(): Boolean = withOptionalFields
    override fun getAccuracy(): Float = 4f
  }

  @Test
  fun mapsLocationFieldsAndStampsTheCaptureTime() {
    val sample = location(withOptionalFields = true).toLocationSample(1_000L)
    assertEquals(1_000.0, sample.t, 0.0)
    assertEquals(59.43, sample.lat, 0.0)
    assertEquals(24.75, sample.lon, 0.0)
    assertEquals(12.0, sample.altitudeM!!, 0.0)
    assertEquals(13.5, sample.speedMps!!, 0.0)
    assertEquals(90.0, sample.courseDeg!!, 0.0)
    assertEquals(4.0, sample.accuracyM!!, 0.0)
    assertNull(sample.roadRmsMps2)
  }

  @Test
  fun leavesMissingLocationFieldsNull() {
    val sample = location(withOptionalFields = false).toLocationSample(1_000L)
    assertNull(sample.speedMps)
    assertNull(sample.courseDeg)
    assertNull(sample.accuracyM)
    // Unit tests run with Build.VERSION.SDK_INT = 0, below the API 26 vertical-accuracy check.
    assertNull(sample.altitudeAccuracyM)
  }

  @Test
  fun imuSampleNeedsAnAccelerometerReading() {
    assertNull(imuSampleOf(1L, accel = null, gyro = floatArrayOf(0f, 0f, 0f)))
  }

  @Test
  fun imuSampleMapsSensorArrays() {
    val sample = imuSampleOf(
      tMs = 1_234L,
      accel = floatArrayOf(0f, 0f, 9.75f),
      linearAccel = floatArrayOf(1f, 2f, 3f),
      gyro = floatArrayOf(0.5f, 0.25f, 0.125f),
      gravity = floatArrayOf(0f, 0f, 9.75f),
    )!!
    assertEquals(1_234.0, sample.t, 0.0)
    assertEquals(Vec3(0.0, 0.0, 9.75), sample.accel)
    assertEquals(Vec3(1.0, 2.0, 3.0), sample.linearAccel)
    assertEquals(Vec3(0.5, 0.25, 0.125), sample.gyro)
    assertEquals(Vec3(0.0, 0.0, 9.75), sample.gravity)
    assertNull(sample.magnetometer)
    assertNull(sample.attitude)
    assertNull(sample.barometerHpa)
  }

  @Test
  fun emptySensorArrayMapsToZero() {
    assertEquals(Vec3(0.0, 0.0, 0.0), floatArrayOf().toVec3())
  }

  @Test
  fun shortSensorArraysPadWithZero() {
    assertEquals(Vec3(1.0, 0.0, 0.0), floatArrayOf(1f).toVec3())
  }
}
