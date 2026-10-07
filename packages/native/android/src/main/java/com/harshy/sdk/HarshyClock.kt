package com.harshy.sdk

import android.os.SystemClock

/**
 * Time source for GPS and IMU sample `t` values, in epoch milliseconds.
 *
 * Detection works on time differences between samples, so every sample in a trip must be stamped by
 * the same clock. Use [monotonic] rather than `System.currentTimeMillis()`: wall-clock corrections
 * during a trip (network time sync, a manual change) would otherwise shift `t` and distort speed and
 * acceleration deltas.
 */
fun interface HarshyClock {
  fun nowMs(): Long

  companion object {
    /** Epoch milliseconds that advance with the boot clock. The epoch offset is fixed at creation. */
    fun monotonic(): HarshyClock = MonotonicEpochClock(SystemClock::elapsedRealtime, System::currentTimeMillis)
  }
}

internal class MonotonicEpochClock(
  private val elapsedRealtimeMs: () -> Long,
  wallClockMs: () -> Long,
) : HarshyClock {
  private val epochOffsetMs: Long = wallClockMs() - elapsedRealtimeMs()

  override fun nowMs(): Long = epochOffsetMs + elapsedRealtimeMs()
}
