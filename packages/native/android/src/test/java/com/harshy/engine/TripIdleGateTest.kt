package com.harshy.engine

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TripIdleGateTest {
  @Test
  fun needsHysteresisBeforeIdle() {
    val gate = TripIdleGate()
    assertFalse(gate.advance(1_000L, 0.0))
    assertFalse(gate.advance(1_000L + TripIdleGate.IDLE_HYSTERESIS_MS - 1, 0.0))
    assertTrue(gate.advance(1_000L + TripIdleGate.IDLE_HYSTERESIS_MS, 0.0))
  }

  @Test
  fun clearsIdleWhenSpeedRises() {
    val gate = TripIdleGate()
    gate.advance(1_000L, 0.0)
    gate.advance(1_000L + TripIdleGate.IDLE_HYSTERESIS_MS, 0.0)
    assertFalse(gate.advance(5_000L, 5.0))
  }

  @Test
  fun throttlesIdleGpsBreadcrumbs() {
    val gate = TripIdleGate()
    gate.advance(1_000L, 0.0)
    gate.advance(1_000L + TripIdleGate.IDLE_HYSTERESIS_MS, 0.0)
    assertTrue(gate.shouldKeepIdleLocation(10_000L, 1.0, 1.0))
    assertFalse(
      gate.shouldKeepIdleLocation(
        10_000L + TripIdleGate.IDLE_LOCATION_INTERVAL_MS / 2,
        1.0,
        1.0,
      ),
    )
    assertTrue(
      gate.shouldKeepIdleLocation(
        10_000L + TripIdleGate.IDLE_LOCATION_INTERVAL_MS,
        1.0,
        1.0,
      ),
    )
  }
}
