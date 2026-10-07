package com.harshy.sdk

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CaptureFromSnapshotTest {
  @Test
  fun readsTheEngineRateSoAnAttachedAnalyzerCapsAtTheRealHz() {
    val capture = captureFromSnapshot(
      mapOf("imuHz" to 100, "locationIntervalMs" to 500L, "background" to false, "trigger" to "auto"),
    )!!
    assertEquals(NativeStartOptions(imuHz = 100, locationIntervalMs = 500L, background = false, trigger = "auto"), capture)
  }

  @Test
  fun missingCaptureGivesNull() {
    assertNull(captureFromSnapshot(null))
    assertNull(captureFromSnapshot("not a map"))
  }
}
