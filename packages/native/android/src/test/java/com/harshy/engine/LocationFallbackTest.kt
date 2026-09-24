package com.harshy.engine

import android.location.LocationManager
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LocationFallbackTest {
  @Test
  fun gpsAlwaysAccepted() {
    assertTrue(
      LocationFallback.shouldAcceptFix(
        LocationManager.GPS_PROVIDER,
        nowMs = 10_000L,
        lastGpsAtMs = 9_000L,
        gpsEnabled = true,
      ),
    )
    assertTrue(
      LocationFallback.shouldAcceptFix(
        "GPS",
        nowMs = 10_000L,
        lastGpsAtMs = 9_000L,
        gpsEnabled = true,
      ),
    )
  }

  @Test
  fun fusedIgnoredWhileGpsIsFresh() {
    assertFalse(
      LocationFallback.shouldAcceptFix(
        LocationFallback.FUSED,
        nowMs = 10_000L,
        lastGpsAtMs = 9_500L,
        gpsEnabled = true,
      ),
    )
    assertFalse(
      LocationFallback.shouldAcceptFix(
        LocationManager.NETWORK_PROVIDER,
        nowMs = 10_000L,
        lastGpsAtMs = 9_500L,
        gpsEnabled = true,
      ),
    )
  }

  @Test
  fun fusedWhenGpsHasGoneSilent() {
    assertTrue(
      LocationFallback.shouldAcceptFix(
        LocationFallback.FUSED,
        nowMs = 20_000L,
        lastGpsAtMs = 10_000L,
        gpsEnabled = true,
      ),
    )
  }

  @Test
  fun networkWhenGpsDisabled() {
    assertTrue(
      LocationFallback.shouldAcceptFix(
        LocationManager.NETWORK_PROVIDER,
        nowMs = 1_000L,
        lastGpsAtMs = 999L,
        gpsEnabled = false,
      ),
    )
  }

  @Test
  fun backupBeforeFirstGpsFix() {
    assertTrue(
      LocationFallback.shouldAcceptFix(
        LocationFallback.FUSED,
        nowMs = 100L,
        lastGpsAtMs = null,
        gpsEnabled = true,
      ),
    )
  }

  @Test
  fun unnamedProviderIsBackupUntilGpsLocks() {
    assertTrue(
      LocationFallback.shouldAcceptFix(
        null,
        nowMs = 100L,
        lastGpsAtMs = null,
        gpsEnabled = true,
      ),
    )
    assertTrue(
      LocationFallback.shouldAcceptFix(
        "",
        nowMs = 100L,
        lastGpsAtMs = null,
        gpsEnabled = true,
      ),
    )
    assertFalse(
      LocationFallback.shouldAcceptFix(
        null,
        nowMs = 10_000L,
        lastGpsAtMs = 9_500L,
        gpsEnabled = true,
      ),
    )
  }

  @Test
  fun fusedOemNameIsBackup() {
    assertTrue(LocationFallback.isBackup("fused_location"))
    assertTrue(
      LocationFallback.shouldAcceptFix(
        "FusedLocationProvider",
        nowMs = 100L,
        lastGpsAtMs = null,
        gpsEnabled = true,
      ),
    )
  }

  @Test
  fun unknownProviderRejected() {
    assertFalse(
      LocationFallback.shouldAcceptFix(
        "wifi",
        nowMs = 20_000L,
        lastGpsAtMs = null,
        gpsEnabled = false,
      ),
    )
  }

  @Test
  fun searchingGpsIsNotAUsableLock() {
    assertFalse(
      LocationFallback.isUsableGnssFix(
        LocationManager.GPS_PROVIDER,
        accuracyM = 250f,
        hasSpeed = false,
      ),
    )
    assertTrue(
      LocationFallback.isUsableGnssFix(
        LocationManager.GPS_PROVIDER,
        accuracyM = 12f,
        hasSpeed = false,
      ),
    )
    assertTrue(
      LocationFallback.isUsableGnssFix(
        LocationManager.GPS_PROVIDER,
        accuracyM = 8f,
        hasSpeed = true,
      ),
    )
    assertFalse(
      LocationFallback.isUsableGnssFix(
        LocationFallback.FUSED,
        accuracyM = 8f,
        hasSpeed = true,
      ),
    )
  }

  @Test
  fun searchingGpsDroppedWhenFusedIsRegistered() {
    assertTrue(
      LocationFallback.shouldAcceptFix(
        LocationManager.GPS_PROVIDER,
        nowMs = 10_000L,
        lastGpsAtMs = null,
        gpsEnabled = true,
        accuracyM = 250f,
        hasSpeed = false,
        dropSearchingGps = true,
      ),
    )
    assertFalse(
      LocationFallback.shouldAcceptFix(
        LocationManager.GPS_PROVIDER,
        nowMs = 10_000L,
        lastGpsAtMs = 9_000L,
        gpsEnabled = true,
        accuracyM = 250f,
        hasSpeed = false,
        dropSearchingGps = true,
      ),
    )
    assertTrue(
      LocationFallback.shouldAcceptFix(
        LocationManager.GPS_PROVIDER,
        nowMs = 10_000L,
        lastGpsAtMs = null,
        gpsEnabled = true,
        accuracyM = 12f,
        hasSpeed = false,
        dropSearchingGps = true,
      ),
    )
    assertTrue(
      LocationFallback.shouldAcceptFix(
        LocationManager.GPS_PROVIDER,
        nowMs = 10_000L,
        lastGpsAtMs = null,
        gpsEnabled = true,
        accuracyM = 250f,
        hasSpeed = false,
        dropSearchingGps = false,
      ),
    )
  }

  @Test
  fun lastKnownMustBeFresh() {
    assertTrue(
      LocationFallback.isFreshFix(
        elapsedRealtimeNanos = 1_000_000_000L,
        nowElapsedRealtimeNanos = 10_000_000_000L,
        wallTimeMs = 1_000L,
        nowWallMs = 10_000L,
      ),
    )
    assertFalse(
      LocationFallback.isFreshFix(
        elapsedRealtimeNanos = 1_000_000_000L,
        nowElapsedRealtimeNanos = 40_000_000_000L,
        wallTimeMs = 1_000L,
        nowWallMs = 40_000L,
      ),
    )
    assertTrue(
      LocationFallback.isFreshFix(
        elapsedRealtimeNanos = 0L,
        nowElapsedRealtimeNanos = 40_000_000_000L,
        wallTimeMs = 9_000L,
        nowWallMs = 10_000L,
      ),
    )
    assertFalse(
      LocationFallback.isFreshFix(
        elapsedRealtimeNanos = 0L,
        nowElapsedRealtimeNanos = 40_000_000_000L,
        wallTimeMs = 1_000L,
        nowWallMs = 40_000L,
      ),
    )
  }
}
