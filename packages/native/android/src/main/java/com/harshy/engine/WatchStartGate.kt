package com.harshy.engine

import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Probe that starts a trip from the armed watch without the JS runtime.
 * Matches core `shouldStartTrip` defaults (10 km/h, 40 m, 5 s).
 */
object WatchStartGate {
  const val START_SPEED_MPS = 10.0 / 3.6
  const val START_DISTANCE_M = 40.0
  const val START_HOLD_MS = 5_000L
  const val MAX_ACCURACY_M = 50.0
  private const val NEGLIGIBLE_SPEED_MPS = 0.5
  private const val MAX_INFER_SEC = 60.0

  data class State(
    val movingSinceMs: Long? = null,
    val distanceM: Double = 0.0,
    val lastLat: Double? = null,
    val lastLon: Double? = null,
    val lastT: Long? = null,
  )

  data class Decision(val start: Boolean, val state: State)

  fun consider(
    state: State,
    t: Long,
    lat: Double,
    lon: Double,
    speedMps: Double?,
    accuracyM: Double?,
    activity: String,
  ): Decision {
    if (!lat.isFinite() || !lon.isFinite()) {
      return Decision(false, state)
    }
    if (accuracyM != null && accuracyM.isFinite() && accuracyM > MAX_ACCURACY_M) {
      return Decision(false, state)
    }
    val from = if (state.lastLat != null && state.lastLon != null && state.lastT != null) {
      state.lastT to (state.lastLat to state.lastLon)
    } else {
      null
    }
    val speed = kinematicSpeed(from, t, lat, lon, speedMps)
    val pinned = state.copy(lastLat = lat, lastLon = lon, lastT = t)
    val walkingLike = activity == "walking" || activity == "running"
    val blocked = activity == "cycling" || activity == "walking" || activity == "running"
    if (blocked && !(walkingLike && speed != null && speed >= START_SPEED_MPS)) {
      return Decision(false, pinned.copy(movingSinceMs = null, distanceM = 0.0))
    }
    if (speed == null || !speed.isFinite()) {
      val reset = if (from != null) pinned.copy(movingSinceMs = null, distanceM = 0.0) else pinned
      return Decision(false, reset)
    }
    if (speed < START_SPEED_MPS) {
      return Decision(false, pinned.copy(movingSinceMs = null, distanceM = 0.0))
    }
    var distance = state.distanceM
    if (state.lastLat != null && state.lastLon != null) {
      distance += haversineM(state.lastLat, state.lastLon, lat, lon)
    }
    val movingSince = state.movingSinceMs ?: t
    val next = pinned.copy(movingSinceMs = movingSince, distanceM = distance)
    val held = t - movingSince >= START_HOLD_MS
    val farEnough = distance >= START_DISTANCE_M
    return Decision(held && farEnough, next)
  }

  private fun kinematicSpeed(
    from: Pair<Long, Pair<Double, Double>>?,
    t: Long,
    lat: Double,
    lon: Double,
    reported: Double?,
  ): Double? {
    val hasReported = reported != null && reported.isFinite() && reported >= 0
    if (hasReported && reported!! >= NEGLIGIBLE_SPEED_MPS) {
      return reported
    }
    if (from != null) {
      val dtSec = (t - from.first) / 1000.0
      if (dtSec in 0.05..MAX_INFER_SEC) {
        val inferred = haversineM(from.second.first, from.second.second, lat, lon) / dtSec
        if (inferred.isFinite()) {
          return inferred
        }
      }
    }
    return if (hasReported) reported else null
  }

  private fun haversineM(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
    val r = 6_371_000.0
    val dLat = Math.toRadians(lat2 - lat1)
    val dLon = Math.toRadians(lon2 - lon1)
    val a = sin(dLat / 2) * sin(dLat / 2) +
      cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLon / 2) * sin(dLon / 2)
    return 2 * r * atan2(sqrt(a), sqrt(1 - a))
  }
}
