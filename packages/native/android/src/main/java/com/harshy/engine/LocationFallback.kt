package com.harshy.engine

import android.location.LocationManager

/**
 * GPS-first location policy. Fused (API 31+) and network are backups when
 * GNSS is off, still searching, or has gone silent — never mixed in while a
 * usable GPS lock is flowing. Analyzer still drops coarse cell/Wi‑Fi teleports.
 *
 * Do not gate fused registration on [LocationManager.getAllProviders] or
 * [LocationManager.isProviderEnabled] — both omit or report fused as off on
 * Pixel / Android 12+ even when [LocationManager.FUSED_PROVIDER] delivers.
 */
internal object LocationFallback {
  const val GPS_STALE_MS = 8_000L
  const val FUSED = "fused"
  /** Match analyzer GNSS-quality accuracy so searching GPS does not block fused. */
  const val GNSS_LOCK_ACCURACY_M = 50f
  /** Skip getLastKnownLocation older than this so a stale fix cannot seed a trip. */
  const val MAX_LAST_KNOWN_AGE_MS = 30_000L

  fun isGps(provider: String?): Boolean =
    provider.equals(LocationManager.GPS_PROVIDER, ignoreCase = true)

  fun isFused(provider: String?): Boolean {
    if (provider.isNullOrBlank()) {
      return false
    }
    val name = provider.lowercase()
    return name == FUSED || name.contains("fused")
  }

  fun isBackup(provider: String?): Boolean {
    if (provider.isNullOrBlank()) {
      return true
    }
    return provider.equals(LocationManager.NETWORK_PROVIDER, ignoreCase = true) ||
      isFused(provider) ||
      provider.equals(LocationManager.PASSIVE_PROVIDER, ignoreCase = true)
  }

  /**
   * GPS chip has a real lock — not a pre-fix with huge accuracy.
   * Only then should fused/network be held back.
   */
  fun isUsableGnssFix(
    provider: String?,
    accuracyM: Float?,
    hasSpeed: Boolean,
    lockAccuracyM: Float = GNSS_LOCK_ACCURACY_M,
  ): Boolean {
    if (!isGps(provider)) {
      return false
    }
    if (accuracyM != null && accuracyM.isFinite() && accuracyM <= lockAccuracyM) {
      return true
    }
    return hasSpeed && (accuracyM == null || !accuracyM.isFinite() || accuracyM <= lockAccuracyM * 2f)
  }

  /**
   * Last-known from [Location.getLastKnownLocation] must be recent.
   * Prefer elapsed realtime; fall back to wall clock when elapsed is unset.
   */
  fun isFreshFix(
    elapsedRealtimeNanos: Long,
    nowElapsedRealtimeNanos: Long,
    wallTimeMs: Long,
    nowWallMs: Long,
    maxAgeMs: Long = MAX_LAST_KNOWN_AGE_MS,
  ): Boolean {
    if (elapsedRealtimeNanos > 0L) {
      val ageNs = nowElapsedRealtimeNanos - elapsedRealtimeNanos
      return ageNs in 0L..(maxAgeMs * 1_000_000L)
    }
    val ageMs = nowWallMs - wallTimeMs
    return ageMs in 0L..maxAgeMs
  }

  /**
   * Accept a fix from [provider]. Usable GPS always. Searching GPS is dropped
   * when [dropSearchingGps] (fused is registered) so a 250 m pre-fix cannot
   * poison the path. Fused / network / passive / unnamed only when GPS is
   * disabled, has not produced a usable lock, or the last usable GPS fix is
   * older than [staleMs].
   */
  fun shouldAcceptFix(
    provider: String?,
    nowMs: Long,
    lastGpsAtMs: Long?,
    gpsEnabled: Boolean,
    staleMs: Long = GPS_STALE_MS,
    accuracyM: Float? = null,
    hasSpeed: Boolean = false,
    dropSearchingGps: Boolean = false,
  ): Boolean {
    if (isGps(provider)) {
      if (dropSearchingGps && !isUsableGnssFix(provider, accuracyM, hasSpeed)) {
        return false
      }
      return true
    }
    if (!isBackup(provider)) {
      return false
    }
    if (!gpsEnabled) {
      return true
    }
    if (lastGpsAtMs == null) {
      return true
    }
    return nowMs - lastGpsAtMs > staleMs
  }
}
