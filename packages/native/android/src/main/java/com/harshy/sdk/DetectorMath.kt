package com.harshy.sdk

import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

internal const val EARTH_RADIUS_M = 6_371_000.0
internal const val DEFAULT_HARSH_MEDIUM_X = 1.5
internal const val DEFAULT_HARSH_HEAVY_X = 2.0

internal val COMPOUND_EVENT_TYPES = setOf(
  EVENT_HARSH_ACCEL,
  EVENT_HARSH_BRAKE,
  EVENT_HARSH_CORNER,
  EVENT_SWERVE,
  EVENT_SPEEDING,
)

internal fun toRad(deg: Double): Double = (deg * Math.PI) / 180.0

internal fun toDeg(rad: Double): Double = (rad * 180.0) / Math.PI

internal fun haversineM(a: LocationSample, b: LocationSample): Double {
  val dLat = toRad(b.lat - a.lat)
  val dLon = toRad(b.lon - a.lon)
  val lat1 = toRad(a.lat)
  val lat2 = toRad(b.lat)
  val h = sin(dLat / 2).let { it * it } +
    cos(lat1) * cos(lat2) * sin(dLon / 2).let { it * it }
  return 2 * EARTH_RADIUS_M * asin(min(1.0, sqrt(h)))
}

internal const val DRIVE_FIX_MAX_SPEED_MPS = 55.0
internal const val DRIVE_FIX_MAX_ACCEL_MPS2 = 12.0
internal const val DRIVE_FIX_ACCEL_MAX_DT_SEC = 8.0
internal const val DRIVE_FIX_SPEED_HOLD_RATIO = 0.6
internal const val DRIVE_FIX_MAX_STEP_M = 80.0
internal const val DRIVE_FIX_RESET_AFTER = 10
internal const val DRIVE_FIX_COARSE_FRACTION_DIGITS = 7
internal const val DRIVE_FIX_GNSS_ACCURACY_M = 50.0

internal fun coordinateFractionDigits(value: Double): Int {
  if (!value.isFinite()) {
    return 0
  }
  val text = java.math.BigDecimal.valueOf(value).stripTrailingZeros().toPlainString()
  val dot = text.indexOf('.')
  if (dot < 0) {
    return 0
  }
  return text.length - dot - 1
}

internal fun derivedSpeedMps(
  from: LocationSample?,
  to: LocationSample,
  maxDtSec: Double = 60.0,
): Double? {
  val reported = to.speedMps
  if (reported != null && reported.isFinite() && reported >= 0.0) {
    return reported
  }
  if (from == null) {
    return null
  }
  val dtSec = (to.t - from.t) / 1000.0
  if (!dtSec.isFinite() || dtSec < 0.05 || dtSec > maxDtSec) {
    return null
  }
  val speed = haversineM(from, to) / dtSec
  return if (speed.isFinite()) speed else null
}

internal const val DERIVED_COURSE_MIN_M = 2.0
internal const val GPS_ACCEL_MIN_DT_SEC = 0.2
internal const val GPS_ACCEL_MAX_DT_SEC = 8.0

internal fun derivedCourseDeg(
  from: LocationSample?,
  to: LocationSample,
  maxDtSec: Double = 60.0,
  minDistanceM: Double = DERIVED_COURSE_MIN_M,
): Double? {
  val reported = to.courseDeg
  if (reported != null && reported.isFinite()) {
    return wrapCourseDeg(reported)
  }
  if (from == null) {
    return null
  }
  val dtSec = (to.t - from.t) / 1000.0
  if (!dtSec.isFinite() || dtSec < 0.05 || dtSec > maxDtSec) {
    return null
  }
  if (haversineM(from, to) < minDistanceM) {
    return null
  }
  val y = sin(toRad(to.lon - from.lon)) * cos(toRad(to.lat))
  val x = cos(toRad(from.lat)) * sin(toRad(to.lat)) -
    sin(toRad(from.lat)) * cos(toRad(to.lat)) * cos(toRad(to.lon - from.lon))
  val deg = toDeg(atan2(y, x))
  return if (deg.isFinite()) wrapCourseDeg(deg) else null
}

internal fun isCoarseNetworkLikeFix(sample: LocationSample): Boolean {
  if (sample.speedMps != null) {
    return false
  }
  val accuracy = sample.accuracyM
  if (accuracy != null && accuracy.isFinite() && accuracy <= DRIVE_FIX_GNSS_ACCURACY_M) {
    return false
  }
  return coordinateFractionDigits(sample.lat) <= DRIVE_FIX_COARSE_FRACTION_DIGITS ||
    coordinateFractionDigits(sample.lon) <= DRIVE_FIX_COARSE_FRACTION_DIGITS
}

internal fun isSuspiciousSpeedLeap(from: LocationSample, to: LocationSample): Boolean {
  val prev = from.speedMps
  val next = to.speedMps
  if (prev == null || next == null || !prev.isFinite() || !next.isFinite()) {
    return false
  }
  val dtSec = (to.t - from.t) / 1000.0
  if (!dtSec.isFinite() || dtSec < 0.0 || dtSec > DRIVE_FIX_ACCEL_MAX_DT_SEC) {
    return false
  }
  val dt = maxOf(dtSec, 0.05)
  val reportedAccel = kotlin.math.abs(next - prev) / dt
  if (reportedAccel <= DRIVE_FIX_MAX_ACCEL_MPS2) {
    return false
  }
  val impliedAccel = kotlin.math.abs(haversineM(from, to) / dt - prev) / dt
  return impliedAccel > DRIVE_FIX_MAX_ACCEL_MPS2
}

internal fun speedLeapHolds(
  anchor: LocationSample,
  leap: LocationSample,
  next: LocationSample,
): Boolean {
  if (!isSuspiciousSpeedLeap(anchor, leap)) {
    return true
  }
  val leapSpeed = leap.speedMps
  val nextSpeed = next.speedMps
  if (
    leapSpeed != null && nextSpeed != null &&
    leapSpeed.isFinite() && nextSpeed.isFinite() &&
    nextSpeed >= leapSpeed * DRIVE_FIX_SPEED_HOLD_RATIO
  ) {
    return true
  }
  val out = haversineM(anchor, leap)
  val back = haversineM(anchor, next)
  val onward = haversineM(leap, next)
  return out >= 1.0 && back > out * 0.85 && onward > out * 0.35
}

internal fun isPlausibleDriveStep(from: LocationSample, to: LocationSample): Boolean {
  val dtMs = maxOf(0.0, to.t - from.t)
  val dtSec = maxOf(dtMs / 1000.0, 0.05)
  val reported = maxOf(from.speedMps ?: 0.0, to.speedMps ?: 0.0)
  val cap = maxOf(DRIVE_FIX_MAX_SPEED_MPS, reported * 1.35 + 8.0)
  return haversineM(from, to) <= cap * dtSec
}

internal data class DriveFixDecision(val accept: Boolean, val rejects: Int)

internal fun shouldAcceptDriveFix(
  anchor: LocationSample?,
  sample: LocationSample,
  consecutiveRejects: Int,
): DriveFixDecision {
  if (isCoarseNetworkLikeFix(sample)) {
    return DriveFixDecision(accept = false, rejects = consecutiveRejects)
  }
  if (anchor == null) {
    return DriveFixDecision(accept = true, rejects = 0)
  }
  if (isPlausibleDriveStep(anchor, sample)) {
    return DriveFixDecision(accept = true, rejects = 0)
  }
  val rejects = consecutiveRejects + 1
  if (rejects >= DRIVE_FIX_RESET_AFTER) {
    return DriveFixDecision(accept = true, rejects = 0)
  }
  return DriveFixDecision(accept = false, rejects = rejects)
}

internal fun unwrapDeltaDeg(fromDeg: Double, toDeg: Double): Double {
  var delta = toDeg - fromDeg
  while (delta > 180) {
    delta -= 360
  }
  while (delta < -180) {
    delta += 360
  }
  return delta
}

internal fun magnitude(vector: Vec3): Double = hypot(hypot(vector.x, vector.y), vector.z)

internal fun mpsToKmh(mps: Double): Double = mps * 3.6

internal fun clamp(value: Double, minValue: Double, maxValue: Double): Double {
  return minOf(maxValue, maxOf(minValue, value))
}

internal fun severityFromPeak(peak: Double, threshold: Double): Double {
  if (threshold <= 0) {
    return 1.0
  }
  return clamp((peak - threshold) / threshold, 0.0, 1.0)
}

internal fun harshLevelRank(level: String): Int {
  return when (level) {
    "norm" -> 0
    "light" -> 1
    "medium" -> 2
    else -> 3
  }
}

internal fun harshLevel(
  peak: Double,
  threshold: Double,
  mediumX: Double = DEFAULT_HARSH_MEDIUM_X,
  heavyX: Double = DEFAULT_HARSH_HEAVY_X,
): String {
  if (!(peak > 0) || threshold <= 0 || peak < threshold) {
    return "norm"
  }
  val ratio = peak / threshold
  if (ratio >= heavyX) {
    return "heavy"
  }
  if (ratio >= mediumX) {
    return "medium"
  }
  return "light"
}

internal fun harshEventLevel(
  peak: Double,
  threshold: Double,
  mediumX: Double = DEFAULT_HARSH_MEDIUM_X,
  heavyX: Double = DEFAULT_HARSH_HEAVY_X,
): String {
  val level = harshLevel(peak, threshold, mediumX, heavyX)
  return if (level == "norm") "light" else level
}

internal data class LiveHarshLevels(
  val accelLevel: String,
  val brakeLevel: String,
  val cornerLevel: String,
  val swerveLevel: String,
)

internal fun liveHarshLevels(
  moving: Boolean,
  longitudinal: Double?,
  lateral: Double?,
  yawRateRadps: Double?,
  config: DetectorConfig,
): LiveHarshLevels {
  if (!moving) {
    return LiveHarshLevels("norm", "norm", "norm", "norm")
  }
  val accelPeak = if (longitudinal != null && longitudinal > 0) longitudinal else 0.0
  val brakePeak = if (longitudinal != null && longitudinal < 0) -longitudinal else 0.0
  val cornerPeak = if (lateral == null) 0.0 else kotlin.math.abs(lateral)
  val swervePeak = if (yawRateRadps == null) 0.0 else kotlin.math.abs(yawRateRadps)
  return LiveHarshLevels(
    accelLevel = harshLevel(accelPeak, config.harshAccelMps2, config.harshMediumX, config.harshHeavyX),
    brakeLevel = harshLevel(brakePeak, config.harshBrakeMps2, config.harshMediumX, config.harshHeavyX),
    cornerLevel = harshLevel(cornerPeak, config.harshCornerMps2, config.harshMediumX, config.harshHeavyX),
    swerveLevel = harshLevel(swervePeak, config.harshSwerveRadps, config.harshMediumX, config.harshHeavyX),
  )
}

internal fun isCompoundType(type: String): Boolean = type in COMPOUND_EVENT_TYPES

internal fun addOverlap(event: DrivingEvent, type: String) {
  if (event.type == type || event.overlaps.contains(type)) {
    return
  }
  event.overlaps.add(type)
}

internal fun eventSpanEnd(event: DrivingEvent, now: Double): Double {
  val endT = event.endT
  if (endT != null) {
    return endT
  }
  if (event.type == EVENT_SPEEDING) {
    return now
  }
  return event.t
}

internal fun eventsOverlap(a: DrivingEvent, b: DrivingEvent, now: Double, windowMs: Double): Boolean {
  val a0 = a.t
  val a1 = eventSpanEnd(a, now)
  val b0 = b.t
  val b1 = eventSpanEnd(b, now)
  return a0 - windowMs <= b1 && b0 <= a1 + windowMs
}

internal fun tagCompoundOverlaps(
  events: List<DrivingEvent>,
  incoming: DrivingEvent,
  now: Double,
  windowMs: Double,
) {
  if (!isCompoundType(incoming.type)) {
    return
  }
  for (other in events) {
    if (other.id == incoming.id) {
      continue
    }
    if (!isCompoundType(other.type) || other.type == incoming.type) {
      continue
    }
    if (!eventsOverlap(incoming, other, now, windowMs)) {
      continue
    }
    addOverlap(incoming, other.type)
    addOverlap(other, incoming.type)
  }
}
