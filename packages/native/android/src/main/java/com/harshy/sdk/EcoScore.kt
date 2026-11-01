package com.harshy.sdk

import kotlin.math.max
import kotlin.math.min

/** Relative energy coefficients for a generic car (not liters). Mirrors core `GENERIC_CAR_ECO`. */
data class EcoProfile(
  val id: String = "generic",
  val rolling: Double = 1.0,
  val aero: Double = 0.002,
  val accel: Double = 1.5,
  val vEffMps: Double = 50.0 / 3.6,
  val minDistanceM: Double = 50.0,
  val minSegments: Int = 1,
)

val GENERIC_CAR_ECO = EcoProfile()

data class TripEcoEstimate(
  val ecoScore: Double?,
  val ecoRatio: Double?,
  val ecoEnergy: Double?,
  val ecoOptimal: Double?,
  val vehicleProfileId: String,
)

/** Map consumption ratio to 0–100. ratio 1 → 100, 2 → 50, 3 → 0. */
fun ecoScoreFromRatio(ratio: Double): Double {
  if (!ratio.isFinite() || ratio <= 0.0) {
    return 100.0
  }
  return max(0.0, min(100.0, kotlin.math.round((100.0 * (3.0 - ratio)) / 2.0)))
}

/**
 * Estimate relative fuel energy and eco score from a GPS path.
 * Does not use IMU. Does not affect driving-quality points/score.
 */
fun estimateTripEco(
  samples: List<LocationSample>,
  distanceM: Double? = null,
  profile: EcoProfile = GENERIC_CAR_ECO,
): TripEcoEstimate {
  val empty = TripEcoEstimate(
    ecoScore = null,
    ecoRatio = null,
    ecoEnergy = null,
    ecoOptimal = null,
    vehicleProfileId = profile.id,
  )
  if (samples.size < 2) {
    return empty
  }

  var energy = 0.0
  var pathDistanceM = 0.0
  var segments = 0

  for (i in 1 until samples.size) {
    val prev = samples[i - 1]
    val next = samples[i]
    val dtSec = (next.t - prev.t) / 1000.0
    if (!dtSec.isFinite() || dtSec < 0.05 || dtSec > 60.0) {
      continue
    }
    val v0 = speedOf(prev)
    val v1 = speedOf(next)
    if (v0 == null && v1 == null) {
      continue
    }
    val v = when {
      v0 != null && v1 != null -> (v0 + v1) / 2.0
      else -> (v0 ?: v1)!!
    }
    val stepM = haversineM(prev, next)
    if (!stepM.isFinite() || stepM < 0.0) {
      continue
    }
    val dist = if (stepM > 0.05) stepM else max(0.0, v * dtSec)
    if (dist <= 0.0 && v < 0.3) {
      continue
    }
    var a = 0.0
    if (v0 != null && v1 != null) {
      a = (v1 - v0) / dtSec
      if (!a.isFinite()) {
        a = 0.0
      }
    }
    energy += profile.rolling * dist
    energy += profile.aero * v * v * v * dtSec
    energy += profile.accel * max(a, 0.0) * v * dtSec
    pathDistanceM += dist
    segments += 1
  }

  val distance =
    if (distanceM != null && distanceM.isFinite() && distanceM > 0.0) distanceM else pathDistanceM
  if (segments < profile.minSegments || distance < profile.minDistanceM || energy <= 0.0) {
    return empty
  }

  val vEff = profile.vEffMps
  val optimal = profile.rolling * distance + profile.aero * vEff * vEff * distance
  if (optimal <= 0.0) {
    return empty
  }
  val ratio = energy / optimal
  return TripEcoEstimate(
    ecoScore = ecoScoreFromRatio(ratio),
    ecoRatio = ratio,
    ecoEnergy = energy,
    ecoOptimal = optimal,
    vehicleProfileId = profile.id,
  )
}

private fun speedOf(sample: LocationSample): Double? {
  val v = sample.speedMps ?: return null
  if (!v.isFinite() || v < 0.0) {
    return null
  }
  return v
}
