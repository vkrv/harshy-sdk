package com.harshy.sdk

/**
 * Thins a location stream to roughly one fix per [intervalMs]. Fixes arriving up to 10% early
 * still pass, so a 500 ms provider stream throttled to 1 s keeps every second fix.
 */
internal class LocationThrottle(intervalMs: Long) {
  private val minGapMs = intervalMs * MIN_GAP_RATIO
  private var lastAcceptedMs: Long? = null

  fun accept(tMs: Long): Boolean {
    val last = lastAcceptedMs
    if (last != null && tMs - last < minGapMs) {
      return false
    }
    lastAcceptedMs = tMs
    return true
  }

  private companion object {
    const val MIN_GAP_RATIO = 0.9
  }
}
