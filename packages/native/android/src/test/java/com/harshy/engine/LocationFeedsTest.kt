package com.harshy.engine

import android.location.Location
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LocationFeedsTest {
  @Test
  fun eachProviderGetsItsOwnListener() {
    val feeds = LocationFeeds()
    val seen = mutableListOf<Any>()
    val previous = feeds.open(listOf("gps", "fused", "network"), { _, listener ->
      seen.add(listener)
      true
    }) {}
    assertTrue(previous.isEmpty())
    assertEquals(3, seen.size)
    assertEquals(3, seen.distinct().size)
    assertEquals(seen, feeds.activeListeners())
  }

  @Test
  fun secondOpenReplacesListeners() {
    val feeds = LocationFeeds()
    feeds.open(listOf("gps", "network"), { _, _ -> true }) {}
    val first = feeds.activeListeners()
    val previous = feeds.open(listOf("gps"), { _, _ -> true }) {}
    val second = feeds.activeListeners()
    assertEquals(first, previous)
    assertEquals(1, second.size)
    assertTrue(previous.none { it === second.single() })
  }

  @Test
  fun listCallbackForwardsEveryFix() {
    var count = 0
    val listener = ForwardingLocationListener { count += 1 }
    listener.onLocationChanged(mutableListOf(Location("gps"), Location("fused")))
    listener.onLocationChanged(Location("gps"))
    assertEquals(3, count)
  }

  @Test
  fun failedProviderIsNotKept() {
    val feeds = LocationFeeds()
    feeds.open(listOf("gps", "fused"), { provider, _ -> provider == "gps" }) {}
    assertEquals(1, feeds.activeListeners().size)
    val removed = feeds.close()
    assertEquals(1, removed.size)
    assertTrue(feeds.activeListeners().isEmpty())
    assertTrue(feeds.close().isEmpty())
  }
}
