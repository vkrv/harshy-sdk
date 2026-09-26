package com.harshy.engine

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ForegroundServiceHandoffTest {
  @Test
  fun autoStopKeepsAServiceThatIsAlreadyUp() {
    assertTrue(ForegroundServiceHandoff.keepRunning(handoffToWatch = true, serviceAlreadyStarted = true))
    assertFalse(ForegroundServiceHandoff.shouldStartService(serviceAlreadyStarted = true))
  }

  @Test
  fun manualStopDropsTheService() {
    assertFalse(ForegroundServiceHandoff.keepRunning(handoffToWatch = false, serviceAlreadyStarted = true))
  }

  @Test
  fun autoStopWithoutAServiceStillNeedsAStart() {
    assertFalse(ForegroundServiceHandoff.keepRunning(handoffToWatch = true, serviceAlreadyStarted = false))
    assertTrue(ForegroundServiceHandoff.shouldStartService(serviceAlreadyStarted = false))
  }
}
