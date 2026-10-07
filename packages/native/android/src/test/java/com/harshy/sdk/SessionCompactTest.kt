package com.harshy.sdk

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionCompactTest {
  private val fix = LocationSample(
    t = 1.0,
    lat = 32.0,
    lon = 34.0,
    altitudeM = 10.0,
    speedMps = 10.0,
    courseDeg = 90.0,
    accuracyM = 5.0,
    altitudeAccuracyM = 2.0,
    roadRmsMps2 = 1.4,
  )

  private fun session(): SessionExport = SessionExport(
    sessionId = "trip-1",
    startedAt = "2026-09-09T10:00:00.000Z",
    endedAt = "2026-09-09T10:05:00.000Z",
    config = DetectorConfig.DEFAULT,
    location = listOf(fix, fix.copy(t = 2.0)),
    imu = listOf(ImuSample(t = 1.0, accel = Vec3(0.0, 0.0, 9.8))),
    events = emptyList(),
    metrics = TripMetrics(1200.0, 300_000.0, 14.0, 10.0, -8.0, 92.0, mapOf("harsh_brake" to 1)),
    device = DeviceInfo("android", "test"),
  )

  @Test
  fun compactLocationKeepsSpeedAccuracyAndRoadRms() {
    assertEquals(
      LocationSample(t = 1.0, lat = 32.0, lon = 34.0, speedMps = 10.0, accuracyM = 5.0, roadRmsMps2 = 1.4),
      compactLocationSample(fix),
    )
  }

  @Test
  fun compactSessionDropsImuAndKeepsEveryLocationSample() {
    val compact = compactSessionExport(session())
    assertTrue(compact.imu.isEmpty())
    assertEquals(listOf(1.0, 2.0), compact.location.map { it.t })
    assertTrue(compact.location.all { it.altitudeM == null && it.courseDeg == null && it.altitudeAccuracyM == null })
  }

  @Test
  fun compactSessionLeavesEverythingElseUntouched() {
    val original = session()
    val compact = compactSessionExport(original)
    assertEquals(original, compact.copy(location = original.location, imu = original.imu))
  }

  @Test
  fun compactJsonOmitsTheDroppedLocationFields() {
    val json = compactSessionExport(session()).toJsonObject()
    val first = json.getJSONArray("location").getJSONObject(0)
    assertFalse(first.has("altitudeM"))
    assertFalse(first.has("courseDeg"))
    assertFalse(first.has("altitudeAccuracyM"))
    assertEquals(0, json.getJSONArray("imu").length())
    assertTrue(JSONObject(json.toString()).has("metrics"))
  }
}
