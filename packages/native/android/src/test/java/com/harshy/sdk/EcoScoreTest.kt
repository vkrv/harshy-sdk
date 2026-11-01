package com.harshy.sdk

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EcoScoreTest {
  @Test
  fun ratioEndpoints() {
    assertEquals(100.0, ecoScoreFromRatio(1.0), 0.0)
    assertEquals(50.0, ecoScoreFromRatio(2.0), 0.0)
    assertEquals(0.0, ecoScoreFromRatio(3.0), 0.0)
    assertEquals(0.0, ecoScoreFromRatio(4.0), 0.0)
  }

  @Test
  fun shortTripIsNull() {
    val samples = path(listOf(13.9, 13.9), stepM = 10.0)
    val eco = estimateTripEco(samples)
    assertNull(eco.ecoScore)
    assertEquals("generic", eco.vehicleProfileId)
  }

  @Test
  fun steadyCruiseNear100() {
    val v = GENERIC_CAR_ECO.vEffMps
    val samples = path(List(40) { v }, stepM = 20.0)
    val eco = estimateTripEco(samples)
    assertNotNull(eco.ecoScore)
    assertTrue(eco.ecoScore!! >= 95.0)
    assertTrue(eco.ecoRatio!! in 0.9..1.1)
  }

  @Test
  fun stopAndGoWorseThanCruise() {
    val v = GENERIC_CAR_ECO.vEffMps
    val cruise = estimateTripEco(path(List(40) { v }, stepM = 20.0))
    val choppy = MutableList(40) { i -> if (i % 4 < 2) 2.0 else 22.0 }
    val busy = estimateTripEco(path(choppy, stepM = 20.0))
    assertNotNull(cruise.ecoScore)
    assertNotNull(busy.ecoScore)
    assertTrue(busy.ecoScore!! < cruise.ecoScore!!)
    assertTrue(busy.ecoRatio!! > cruise.ecoRatio!!)
  }

  private fun path(speeds: List<Double>, stepM: Double, dtMs: Double = 1000.0): List<LocationSample> {
    val dLat = stepM / 111_320.0
    return speeds.mapIndexed { i, speed ->
      LocationSample(
        t = i * dtMs,
        lat = 32.08 + i * dLat,
        lon = 34.78,
        altitudeM = null,
        speedMps = speed,
        courseDeg = null,
        accuracyM = 5.0,
        altitudeAccuracyM = null,
      )
    }
  }
}
