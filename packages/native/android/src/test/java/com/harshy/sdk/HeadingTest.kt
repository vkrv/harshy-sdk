package com.harshy.sdk

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

class HeadingTest {
  private val minSpeed = DetectorConfig.DEFAULT.minSpeedMps

  private fun loc(t: Double, speedMps: Double, courseDeg: Double): LocationSample {
    return LocationSample(
      t = t,
      lat = 32.0,
      lon = 34.0,
      speedMps = speedMps,
      courseDeg = courseDeg,
      accuracyM = 5.0,
    )
  }

  @Test
  fun wrapsCourseIntoCircle() {
    assertEquals(10.0, wrapCourseDeg(370.0), 0.001)
    assertEquals(350.0, wrapCourseDeg(-10.0), 0.001)
  }

  @Test
  fun staysBlankWhileStopped() {
    var filter = HeadingFilter()
    filter = advanceHeadingFilter(filter, loc(0.0, 0.0, 12.0), minSpeed)
    filter = advanceHeadingFilter(filter, loc(500.0, 0.4, 200.0), minSpeed)
    assertNull(filter.headingDeg)
  }

  @Test
  fun locksAfterTwoAgreeingMovingFixesThenHolds() {
    var filter = HeadingFilter()
    filter = advanceHeadingFilter(filter, loc(0.0, 6.0, 88.0), minSpeed)
    assertNull(filter.headingDeg)
    filter = advanceHeadingFilter(filter, loc(500.0, 6.0, 90.0), minSpeed)
    val locked = filter.headingDeg
    assertTrue(locked != null && abs(locked - 89.0) < 2.0)
    filter = advanceHeadingFilter(filter, loc(1000.0, 0.0, 15.0), minSpeed)
    filter = advanceHeadingFilter(filter, loc(1500.0, 0.3, 300.0), minSpeed)
    assertEquals(locked!!, filter.headingDeg!!, 0.001)
  }
}
