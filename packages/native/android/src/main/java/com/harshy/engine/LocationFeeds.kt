package com.harshy.engine

import android.location.Location
import android.location.LocationListener
import android.os.Bundle

/**
 * One [LocationListener] per provider, replaced on every open.
 *
 * Android keeps a dead transport for a listener after [android.location.LocationManager.removeUpdates].
 * The next [android.location.LocationManager.requestLocationUpdates] on that same instance throws
 * [IllegalStateException] and is easy to swallow, so the second trip gets IMU and no GPS.
 * A new listener takes the fresh-transport path. Separate instances also keep a later provider
 * from replacing an earlier one when the OS keys registrations by listener.
 */
internal class ForwardingLocationListener(
  private val onLocation: (Location) -> Unit,
) : LocationListener {
  override fun onLocationChanged(locations: MutableList<Location>) {
    for (location in locations) {
      onLocation(location)
    }
  }

  override fun onLocationChanged(location: Location) {
    onLocation(location)
  }

  @Deprecated("Deprecated in Android")
  override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit

  override fun onProviderEnabled(provider: String) = Unit

  override fun onProviderDisabled(provider: String) = Unit
}

internal class LocationFeeds {
  private val active = mutableListOf<LocationListener>()

  fun activeListeners(): List<LocationListener> = active.toList()

  /**
   * Register [providers]. Returns the previous listeners so the caller can
   * [android.location.LocationManager.removeUpdates] them after the new requests exist.
   */
  fun open(
    providers: List<String>,
    register: (provider: String, listener: LocationListener) -> Boolean,
    onLocation: (Location) -> Unit,
  ): List<LocationListener> {
    val previous = active.toList()
    val next = mutableListOf<LocationListener>()
    for (provider in providers) {
      if (provider.isBlank()) {
        continue
      }
      val listener = ForwardingLocationListener(onLocation)
      val ok = try {
        register(provider, listener)
      } catch (_: Exception) {
        false
      }
      if (ok) {
        next.add(listener)
      }
    }
    active.clear()
    active.addAll(next)
    return previous
  }

  fun close(): List<LocationListener> {
    val previous = active.toList()
    active.clear()
    return previous
  }
}
