package com.harshy.engine

import org.junit.Assert.assertEquals
import org.junit.Test

class WatchFixMapsTest {
  @Test
  fun unknownWhenNoSteps() {
    assertEquals("unknown", WatchFixMaps.activityFromSteps(10_000L, null))
  }

  @Test
  fun unknownWhenStepsButVehicleSpeed() {
    assertEquals(
      "unknown",
      WatchFixMaps.activityFromSteps(10_000L, 9_500L, 12.0),
    )
    assertEquals(
      "walking",
      WatchFixMaps.activityFromSteps(10_000L, 9_500L, 1.0),
    )
  }

  @Test
  fun walkingWhileStepsAreFresh() {
    assertEquals(
      "walking",
      WatchFixMaps.activityFromSteps(
        WatchFixMaps.STEP_WALKING_WINDOW_MS,
        0L,
      ),
    )
    assertEquals(
      "walking",
      WatchFixMaps.activityFromSteps(8_000L, 1L),
    )
  }

  @Test
  fun unknownAfterStepWindow() {
    assertEquals(
      "unknown",
      WatchFixMaps.activityFromSteps(
        WatchFixMaps.STEP_WALKING_WINDOW_MS + 1,
        0L,
      ),
    )
  }

  @Test
  fun watchSampleOmitsMissingSpeedAndAccuracy() {
    val sample = WatchFixMaps.fromFields(
      nowMs = 12_000L,
      lat = 59.437,
      lon = 24.753,
      speedMps = null,
      accuracyM = 8.0,
      activity = "automotive",
    )
    assertEquals(12_000L, sample["t"])
    assertEquals(59.437, sample["lat"] as Double, 1e-9)
    assertEquals(null, sample["speedMps"])
    assertEquals(8.0, sample["accuracyM"] as Double, 1e-9)
    assertEquals("automotive", sample["activity"])
  }
}
