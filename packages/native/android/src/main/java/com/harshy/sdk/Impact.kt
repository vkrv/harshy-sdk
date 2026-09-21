package com.harshy.sdk

import kotlin.math.abs
import kotlin.math.acos

internal const val DEFAULT_IMPACT_FLOOR_MPS2 = 15.0
internal const val DEFAULT_IMPACT_PEAK_MPS2 = 35.0
internal const val DEFAULT_IMPACT_PEAK_HIGH_MPS2 = 59.0
internal const val DEFAULT_IMPACT_PULSE_MAX_MS = 400.0
internal const val DEFAULT_IMPACT_SPEED_DELTA_MPS = 4.0
internal const val DEFAULT_IMPACT_LOOKAHEAD_MS = 2000.0
internal const val DEFAULT_IMPACT_COOLDOWN_MS = 5000.0
internal const val DEFAULT_IMPACT_VERTICAL_MAX = 0.72
internal const val DEFAULT_IMPACT_FREE_FALL_MPS2 = 3.0
internal const val DEFAULT_IMPACT_FREE_FALL_LOOKBACK_MS = 400.0
internal const val DEFAULT_IMPACT_ROLLOVER_DEG = 50.0

internal data class ImpactPulse(
  val startT: Double,
  var lastAboveT: Double,
  var peakT: Double,
  var peakMag: Double,
  var peakLinear: Vec3,
  val gravityStart: Vec3?,
  var gravityPeak: Vec3?,
  var gravityLast: Vec3?,
)

internal data class PendingImpact(
  val t: Double,
  val peak: Double,
  val rollover: Boolean,
  val lat: Double?,
  val lon: Double?,
  val speedBeforeMps: Double?,
)

internal sealed class ClosedPulseDecision {
  data object Reject : ClosedPulseDecision()
  data class Pending(val pending: PendingImpact) : ClosedPulseDecision()
}

internal sealed class PendingImpactDecision {
  data object Wait : PendingImpactDecision()
  data object Discard : PendingImpactDecision()
  data class Emit(val direction: String, val speedMps: Double?) : PendingImpactDecision()
}

internal data class PulseStep(
  val pulse: ImpactPulse?,
  val closed: ImpactPulse?,
)

internal fun copyVec(vector: Vec3): Vec3 = Vec3(vector.x, vector.y, vector.z)

internal fun sampleLinearAccel(sample: ImuSample): Vec3 {
  val linear = sample.linearAccel
  if (linear != null) {
    return linear
  }
  val gravity = sample.gravity
  if (gravity != null) {
    return Vec3(
      sample.accel.x - gravity.x,
      sample.accel.y - gravity.y,
      sample.accel.z - gravity.z,
    )
  }
  return sample.accel
}

internal fun verticalShare(linear: Vec3, gravity: Vec3?): Double {
  val accelMag = magnitude(linear)
  if (accelMag < 1e-6) {
    return 0.0
  }
  if (gravity == null) {
    return abs(linear.z) / accelMag
  }
  val gravityMag = magnitude(gravity)
  if (gravityMag < 0.5) {
    return 0.0
  }
  return abs(linear.x * gravity.x + linear.y * gravity.y + linear.z * gravity.z) /
    (accelMag * gravityMag)
}

internal fun gravityTiltDeg(from: Vec3?, to: Vec3?): Double {
  if (from == null || to == null) {
    return 0.0
  }
  val fromMag = magnitude(from)
  val toMag = magnitude(to)
  if (fromMag < 0.5 || toMag < 0.5) {
    return 0.0
  }
  val dot = clamp(
    (from.x * to.x + from.y * to.y + from.z * to.z) / (fromMag * toMag),
    -1.0,
    1.0,
  )
  return (acos(dot) * 180.0) / Math.PI
}

internal fun locationSpeedUsable(sample: LocationSample, maxLocationAccuracyM: Double): Double? {
  val speed = sample.speedMps ?: return null
  val accuracy = sample.accuracyM
  if (accuracy != null && accuracy > maxLocationAccuracyM) {
    return null
  }
  return speed
}

internal fun lastUsableSpeedInWindow(
  location: List<LocationSample>,
  lo: Double,
  hi: Double,
  maxLocationAccuracyM: Double,
): Double? {
  for (i in location.indices.reversed()) {
    val sample = location[i]
    if (sample.t > hi) {
      continue
    }
    if (sample.t < lo) {
      break
    }
    val speed = locationSpeedUsable(sample, maxLocationAccuracyM)
    if (speed != null) {
      return speed
    }
  }
  return null
}

internal fun hadFreeFall(
  imu: List<ImuSample>,
  pulseStartT: Double,
  lookbackMs: Double,
  freeFallMps2: Double,
): Boolean {
  val lo = pulseStartT - lookbackMs
  for (i in imu.indices.reversed()) {
    val sample = imu[i]
    if (sample.t >= pulseStartT) {
      continue
    }
    if (sample.t < lo) {
      break
    }
    if (magnitude(sample.accel) < freeFallMps2) {
      return true
    }
  }
  return false
}

internal fun classifyImpactDirection(
  rollover: Boolean,
  speedDeltaMps: Double?,
  speedDeltaMin: Double,
): String {
  if (rollover) {
    return "rollover"
  }
  if (speedDeltaMps == null || speedDeltaMin <= 0) {
    return "unknown"
  }
  if (speedDeltaMps <= -speedDeltaMin) {
    return "front"
  }
  if (speedDeltaMps >= speedDeltaMin) {
    return "rear"
  }
  return "unknown"
}

internal fun advanceImpactPulse(
  pulse: ImpactPulse?,
  sample: ImuSample,
  floorMps2: Double,
): PulseStep {
  val linear = sampleLinearAccel(sample)
  val mag = magnitude(linear)
  if (mag >= floorMps2) {
    if (pulse == null) {
      return PulseStep(
        pulse = ImpactPulse(
          startT = sample.t,
          lastAboveT = sample.t,
          peakT = sample.t,
          peakMag = mag,
          peakLinear = copyVec(linear),
          gravityStart = sample.gravity?.let { copyVec(it) },
          gravityPeak = sample.gravity?.let { copyVec(it) },
          gravityLast = sample.gravity?.let { copyVec(it) },
        ),
        closed = null,
      )
    }
    pulse.lastAboveT = sample.t
    pulse.gravityLast = sample.gravity?.let { copyVec(it) } ?: pulse.gravityLast
    if (mag > pulse.peakMag) {
      pulse.peakMag = mag
      pulse.peakT = sample.t
      pulse.peakLinear = copyVec(linear)
      pulse.gravityPeak = sample.gravity?.let { copyVec(it) } ?: pulse.gravityPeak
    }
    return PulseStep(pulse = pulse, closed = null)
  }
  if (pulse != null) {
    return PulseStep(pulse = null, closed = pulse)
  }
  return PulseStep(pulse = null, closed = null)
}

internal fun decideClosedPulse(
  pulse: ImpactPulse,
  imu: List<ImuSample>,
  location: List<LocationSample>,
  lastLat: Double?,
  lastLon: Double?,
  startedAtMs: Double,
  lastImpactAt: Double?,
  config: DetectorConfig,
): ClosedPulseDecision {
  val width = pulse.lastAboveT - pulse.startT
  if (width > config.impactPulseMaxMs) {
    return ClosedPulseDecision.Reject
  }
  if (pulse.peakMag < config.impactPeakMps2) {
    return ClosedPulseDecision.Reject
  }
  if (pulse.startT - startedAtMs < config.jerkSettleMs) {
    return ClosedPulseDecision.Reject
  }
  if (lastImpactAt != null && pulse.peakT - lastImpactAt < config.impactCooldownMs) {
    return ClosedPulseDecision.Reject
  }
  if (
    hadFreeFall(
      imu,
      pulse.startT,
      config.impactFreeFallLookbackMs,
      config.impactFreeFallMps2,
    )
  ) {
    return ClosedPulseDecision.Reject
  }
  if (verticalShare(pulse.peakLinear, pulse.gravityPeak) > config.impactVerticalMax) {
    return ClosedPulseDecision.Reject
  }

  val speedBefore = lastUsableSpeedInWindow(
    location,
    pulse.peakT - config.impactLookaheadMs,
    pulse.peakT,
    config.maxLocationAccuracyM,
  )
  if (speedBefore == null || speedBefore < config.minSpeedMps) {
    return ClosedPulseDecision.Reject
  }

  val rollover =
    gravityTiltDeg(pulse.gravityStart, pulse.gravityLast ?: pulse.gravityPeak) >=
      config.impactRolloverDeg

  return ClosedPulseDecision.Pending(
    PendingImpact(
      t = pulse.peakT,
      peak = pulse.peakMag,
      rollover = rollover,
      lat = lastLat,
      lon = lastLon,
      speedBeforeMps = speedBefore,
    ),
  )
}

internal fun decidePendingImpact(
  pending: PendingImpact,
  location: List<LocationSample>,
  now: Double,
  force: Boolean,
  config: DetectorConfig,
): PendingImpactDecision {
  val speedAfter = lastUsableSpeedInWindow(
    location,
    pending.t + 1,
    pending.t + config.impactLookaheadMs,
    config.maxLocationAccuracyM,
  )
  val speedDelta =
    if (pending.speedBeforeMps != null && speedAfter != null) {
      speedAfter - pending.speedBeforeMps
    } else {
      null
    }
  val gpsConfirms =
    speedDelta != null &&
      config.impactSpeedDeltaMps > 0 &&
      abs(speedDelta) >= config.impactSpeedDeltaMps
  val skipGps = config.impactSpeedDeltaMps <= 0
  val highPeak = pending.peak >= config.impactPeakHighMps2
  val lookaheadElapsed = now >= pending.t + config.impactLookaheadMs

  if (pending.rollover || gpsConfirms || highPeak || skipGps) {
    return PendingImpactDecision.Emit(
      direction = classifyImpactDirection(
        rollover = pending.rollover,
        speedDeltaMps = speedDelta,
        speedDeltaMin = config.impactSpeedDeltaMps,
      ),
      speedMps = speedAfter ?: pending.speedBeforeMps,
    )
  }

  if (lookaheadElapsed || force) {
    return PendingImpactDecision.Discard
  }
  return PendingImpactDecision.Wait
}
