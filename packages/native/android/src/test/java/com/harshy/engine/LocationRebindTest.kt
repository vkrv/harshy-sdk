package com.harshy.engine

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LocationRebindTest {
  @Test
  fun schedulesOnceWhileTheTripHasNoFix() {
    assertTrue(LocationRebind.shouldSchedule(sampleCount = 0, alreadyRebound = false))
  }

  @Test
  fun doesNotScheduleAgainAfterTheRetry() {
    assertFalse(LocationRebind.shouldSchedule(sampleCount = 0, alreadyRebound = true))
  }

  @Test
  fun doesNotScheduleOnceAFixIsStored() {
    assertFalse(LocationRebind.shouldSchedule(sampleCount = 1, alreadyRebound = false))
    assertFalse(LocationRebind.shouldSchedule(sampleCount = 1, alreadyRebound = true))
  }
}
