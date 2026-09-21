package com.harshy.sdk

import com.harshy.engine.TripLivePayload
import org.junit.Assert.assertEquals
import org.junit.Test

class TripLiveTest {
  @Test
  fun formatsDurationWithAndWithoutHours() {
    assertEquals("0:00", formatTripDuration(0.0))
    assertEquals("1:05", formatTripDuration(65_000.0))
    assertEquals("1:01:01", formatTripDuration(3_661_000.0))
  }

  @Test
  fun payloadFromMapKeepsFallbacksForBlanks() {
    val payload = tripLivePayloadFromMap(
      mapOf(
        "title" to " ",
        "score" to 88,
        "speed" to "",
        "duration" to null,
        "distance" to "1.2 km",
      ),
      "Signumb",
    )
    assertEquals("Signumb", payload.title)
    assertEquals("88", payload.score)
    assertEquals("—", payload.speed)
    assertEquals("0:00", payload.duration)
    assertEquals("1.2 km", payload.distance)
    assertEquals("Score 88 · — · 0:00 · 1.2 km", payload.line())
  }

  @Test
  fun payloadFromMetricsUsesRoundedScoreAndKm() {
    val metrics = LiveMetrics(
      t = 1_000.0,
      speedMps = 10.0,
      speedKmh = 36.4,
      headingDeg = 90.0,
      altitudeM = null,
      locationAccuracyM = 5.0,
      longitudinalAccelMps2 = 0.0,
      lateralAccelMps2 = 0.0,
      verticalAccelMps2 = 0.0,
      accelMagnitudeMps2 = 0.0,
      gyroMagnitudeRadps = 0.0,
      accelLevel = "norm",
      brakeLevel = "norm",
      cornerLevel = "norm",
      yawRateRadps = 0.0,
      swerveLevel = "norm",
      distanceM = 1_240.0,
      durationMs = 65_000.0,
      score = 91.6,
    )
    val payload = tripLivePayloadFromMetrics(metrics, "Signumb")
    assertEquals("92", payload.score)
    assertEquals("36 km/h", payload.speed)
    assertEquals("1:05", payload.duration)
    assertEquals("1.24 km", payload.distance)
  }

  @Test
  fun notificationLineJoinsKeyNumbers() {
    val payload = TripLivePayload("Signumb", "90", "40 km/h", "0:12", "0.10 km")
    assertEquals("Score 90 · 40 km/h · 0:12 · 0.10 km", payload.line())
  }
}
