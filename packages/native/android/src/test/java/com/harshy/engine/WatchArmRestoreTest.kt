package com.harshy.engine

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WatchArmRestoreTest {
  @Test
  fun restoresWhenArmedAndIdle() {
    assertTrue(WatchArmRestore.shouldRestore(armedOnDisk = true, running = false, alreadyWatching = false))
  }

  @Test
  fun skipsWhenNotArmed() {
    assertFalse(WatchArmRestore.shouldRestore(armedOnDisk = false, running = false, alreadyWatching = false))
  }

  @Test
  fun skipsWhileTripRuns() {
    assertFalse(WatchArmRestore.shouldRestore(armedOnDisk = true, running = true, alreadyWatching = false))
  }

  @Test
  fun skipsWhenAlreadyWatching() {
    assertFalse(WatchArmRestore.shouldRestore(armedOnDisk = true, running = false, alreadyWatching = true))
  }
}
