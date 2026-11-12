package com.harshy.engine

/**
 * One location retry while a trip is still waiting for its first fix.
 * Scheduling that retry again removes the live request every few seconds, and a
 * cold GNSS fix never completes.
 */
internal object LocationRebind {
  fun shouldSchedule(sampleCount: Int, alreadyRebound: Boolean): Boolean {
    return sampleCount <= 0 && !alreadyRebound
  }
}
