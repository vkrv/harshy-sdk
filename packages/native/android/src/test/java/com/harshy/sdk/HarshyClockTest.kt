package com.harshy.sdk

import org.junit.Assert.assertEquals
import org.junit.Test

class HarshyClockTest {
  private var elapsedMs = 5_000L
  private var wallMs = 1_700_000_000_000L
  private val clock = MonotonicEpochClock({ elapsedMs }, { wallMs })

  @Test
  fun startsAtTheWallClock() {
    assertEquals(1_700_000_000_000L, clock.nowMs())
  }

  @Test
  fun advancesWithTheBootClock() {
    elapsedMs += 1_500L
    assertEquals(1_700_000_001_500L, clock.nowMs())
  }

  @Test
  fun ignoresWallClockJumpsAfterCreation() {
    wallMs += 3_600_000L
    elapsedMs += 10L
    assertEquals(1_700_000_000_010L, clock.nowMs())
  }
}
