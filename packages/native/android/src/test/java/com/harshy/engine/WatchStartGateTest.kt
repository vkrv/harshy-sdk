package com.harshy.engine

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WatchStartGateTest {
  @Test
  fun startsAfterHoldAndDistance() {
    var state = WatchStartGate.State()
    val first = WatchStartGate.consider(state, 0L, 0.0, 0.0, 4.0, 5.0, "unknown")
    assertFalse(first.start)
    state = first.state
    val second = WatchStartGate.consider(state, 6_000L, 0.0, 0.0006, 4.0, 5.0, "unknown")
    assertTrue(second.state.distanceM >= WatchStartGate.START_DISTANCE_M)
    assertTrue(second.start)
  }

  @Test
  fun walkingAtVehicleSpeedDoesNotBlock() {
    val state = WatchStartGate.State(movingSinceMs = 0L, distanceM = 50.0, lastLat = 0.0, lastLon = 0.0, lastT = 0L)
    val decided = WatchStartGate.consider(state, 6_000L, 0.0, 0.0002, 4.0, 5.0, "walking")
    assertTrue(decided.start)
  }

  @Test
  fun cyclingResets() {
    val state = WatchStartGate.State(movingSinceMs = 0L, distanceM = 50.0, lastLat = 0.0, lastLon = 0.0, lastT = 0L)
    val decided = WatchStartGate.consider(state, 6_000L, 0.0, 0.0002, 4.0, 5.0, "cycling")
    assertFalse(decided.start)
    assertTrue(decided.state.distanceM == 0.0)
  }
}
