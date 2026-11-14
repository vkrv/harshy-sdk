package com.harshy.engine

import android.location.LocationManager
import android.location.LocationRequest

/**
 * What to ask Android for.
 *
 * A single high-accuracy fused request withholds every update until GNSS locks.
 * A mock location satisfies that wait immediately, so a spoofed fix appears
 * while the phone's own Wi-Fi and cell fixes never do. GPS stays high accuracy.
 * Fused is also asked at balanced quality, which delivers before the chip locks,
 * and at high accuracy, which keeps the chip in the fusion.
 */
internal object LocationCapture {
  data class Feed(val provider: String, val quality: Int)

  const val CURRENT_FIX_MS = 15_000L

  fun feeds(includeFused: Boolean, includePassive: Boolean = false): List<Feed> {
    val feeds = mutableListOf(
      Feed(LocationManager.GPS_PROVIDER, LocationRequest.QUALITY_HIGH_ACCURACY),
    )
    if (includeFused) {
      feeds += Feed(LocationManager.FUSED_PROVIDER, LocationRequest.QUALITY_BALANCED_POWER_ACCURACY)
      feeds += Feed(LocationManager.FUSED_PROVIDER, LocationRequest.QUALITY_HIGH_ACCURACY)
    }
    feeds += Feed(LocationManager.NETWORK_PROVIDER, LocationRequest.QUALITY_BALANCED_POWER_ACCURACY)
    if (includePassive) {
      feeds += Feed(LocationManager.PASSIVE_PROVIDER, LocationRequest.QUALITY_BALANCED_POWER_ACCURACY)
    }
    return feeds
  }

  /** One fast ask per provider. Fused and network use balanced so they need not wait for GNSS. */
  fun oneShot(includeFused: Boolean): List<Feed> {
    val feeds = mutableListOf(
      Feed(LocationManager.GPS_PROVIDER, LocationRequest.QUALITY_HIGH_ACCURACY),
    )
    if (includeFused) {
      feeds += Feed(LocationManager.FUSED_PROVIDER, LocationRequest.QUALITY_BALANCED_POWER_ACCURACY)
    }
    feeds += Feed(LocationManager.NETWORK_PROVIDER, LocationRequest.QUALITY_BALANCED_POWER_ACCURACY)
    return feeds
  }

  /** Retry only a registration that attached nothing. A live request stays up while GNSS locks. */
  fun shouldRetry(registered: Int, alreadyRetried: Boolean): Boolean {
    return registered <= 0 && !alreadyRetried
  }
}
