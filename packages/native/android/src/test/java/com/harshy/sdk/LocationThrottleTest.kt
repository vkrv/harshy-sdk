package com.harshy.sdk

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LocationThrottleTest {
  @Test
  fun acceptsTheFirstFix() {
    assertTrue(LocationThrottle(1_000L).accept(0L))
  }

  @Test
  fun thinsAHalfSecondStreamToOneFixPerSecond() {
    val throttle = LocationThrottle(1_000L)
    val accepted = (0..6).map { it * 500L }.filter { throttle.accept(it) }
    assertEquals(listOf(0L, 1_000L, 2_000L, 3_000L), accepted)
  }

  @Test
  fun toleratesFixesArrivingSlightlyEarly() {
    val throttle = LocationThrottle(1_000L)
    throttle.accept(0L)
    assertFalse(throttle.accept(899L))
    assertTrue(throttle.accept(900L))
  }
}
