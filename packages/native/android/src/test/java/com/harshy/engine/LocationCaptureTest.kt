package com.harshy.engine

import android.location.LocationManager
import android.location.LocationRequest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LocationCaptureTest {
  @Test
  fun asksGpsHighAndFusedBothWays() {
    val feeds = LocationCapture.feeds(includeFused = true)
    assertEquals(
      listOf(
        LocationCapture.Feed(LocationManager.GPS_PROVIDER, LocationRequest.QUALITY_HIGH_ACCURACY),
        LocationCapture.Feed(LocationManager.FUSED_PROVIDER, LocationRequest.QUALITY_BALANCED_POWER_ACCURACY),
        LocationCapture.Feed(LocationManager.FUSED_PROVIDER, LocationRequest.QUALITY_HIGH_ACCURACY),
        LocationCapture.Feed(LocationManager.NETWORK_PROVIDER, LocationRequest.QUALITY_BALANCED_POWER_ACCURACY),
      ),
      feeds,
    )
  }

  @Test
  fun skipsFusedBeforeApi31AndAddsPassiveForTheWatch() {
    val withoutFused = LocationCapture.feeds(includeFused = false)
    assertTrue(withoutFused.none { it.provider == LocationManager.FUSED_PROVIDER })
    assertEquals(LocationManager.NETWORK_PROVIDER, withoutFused.last().provider)

    val watch = LocationCapture.feeds(includeFused = true, includePassive = true)
    assertEquals(LocationManager.PASSIVE_PROVIDER, watch.last().provider)
    assertEquals(LocationRequest.QUALITY_BALANCED_POWER_ACCURACY, watch.last().quality)
  }

  @Test
  fun oneShotUsesBalancedFusedSoTheFirstFixNeedNotWaitForGnss() {
    val feeds = LocationCapture.oneShot(includeFused = true)
    val fused = feeds.single { it.provider == LocationManager.FUSED_PROVIDER }
    assertEquals(LocationRequest.QUALITY_BALANCED_POWER_ACCURACY, fused.quality)
    assertEquals(
      LocationRequest.QUALITY_HIGH_ACCURACY,
      feeds.single { it.provider == LocationManager.GPS_PROVIDER }.quality,
    )
  }

  @Test
  fun retriesOnlyWhenNothingRegistered() {
    assertTrue(LocationCapture.shouldRetry(registered = 0, alreadyRetried = false))
    assertFalse(LocationCapture.shouldRetry(registered = 0, alreadyRetried = true))
    assertFalse(LocationCapture.shouldRetry(registered = 2, alreadyRetried = false))
  }
}
