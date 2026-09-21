package com.harshy.sdk

internal const val DEFAULT_HANDHELD_TILT_DEG = 35.0
internal const val DEFAULT_HANDHELD_EXIT_TILT_DEG = 18.0
internal const val DEFAULT_HANDHELD_GYRO_RADPS = 1.2
internal const val DEFAULT_HANDHELD_MOTION_MPS2 = 2.0
internal const val DEFAULT_HANDHELD_QUIET_GYRO_RADPS = 0.25
internal const val DEFAULT_HANDHELD_QUIET_MOTION_MPS2 = 0.8
internal const val DEFAULT_HANDHELD_STABLE_MS = 800.0
internal const val DEFAULT_HANDHELD_CONFIRM_MS = 350.0
internal const val DEFAULT_HANDHELD_EXIT_MS = 700.0
internal const val DEFAULT_HANDHELD_COOLDOWN_MS = 2500.0
internal const val DEFAULT_HANDHELD_BASELINE_ALPHA = 0.08

const val PHONE_HANDHELD_TYPE = "phone_handheld"

fun isPhoneHandheld(event: DrivingEvent): Boolean = event.type == PHONE_HANDHELD_TYPE

internal data class HandheldFilter(
  var baseline: Vec3? = null,
  var quietSince: Double? = null,
  var candidateSince: Double? = null,
  var belowExitSince: Double? = null,
)

internal data class HandheldStep(
  val filter: HandheldFilter,
  val open: DrivingEvent?,
  val emitted: DrivingEvent?,
  val lastClosedAt: Double?,
)

private fun blendBaseline(previous: Vec3?, gravity: Vec3, alpha: Double): Vec3 {
  if (previous == null) {
    return copyVec(gravity)
  }
  return Vec3(
    x = previous.x + (gravity.x - previous.x) * alpha,
    y = previous.y + (gravity.y - previous.y) * alpha,
    z = previous.z + (gravity.z - previous.z) * alpha,
  )
}

internal fun emptyHandheldFilter(): HandheldFilter = HandheldFilter()

internal fun advanceHandheld(
  filter: HandheldFilter,
  open: DrivingEvent?,
  lastClosedAt: Double?,
  sample: ImuSample,
  moving: Boolean,
  speedMps: Double?,
  location: LocationSample?,
  startedAtMs: Double,
  config: DetectorConfig,
): HandheldStep {
  val gravity = sample.gravity
  var nextOpen = open
  var nextClosedAt = lastClosedAt
  var emitted: DrivingEvent? = null
  val next = filter.copy(
    baseline = filter.baseline?.let { copyVec(it) },
  )

  if (gravity == null || magnitude(gravity) < 0.5) {
    return HandheldStep(next, nextOpen, emitted, nextClosedAt)
  }

  val gyroMag = sample.gyro?.let { magnitude(it) } ?: 0.0
  val linearMag = magnitude(sampleLinearAccel(sample))
  val quiet =
    gyroMag < config.handheldQuietGyroRadps && linearMag < config.handheldQuietMotionMps2

  if (nextOpen == null && quiet) {
    if (next.quietSince == null) {
      next.quietSince = sample.t
    }
    if (sample.t - (next.quietSince ?: sample.t) >= config.handheldStableMs) {
      next.baseline = blendBaseline(
        next.baseline,
        gravity,
        if (next.baseline == null) 1.0 else config.handheldBaselineAlpha,
      )
    }
  } else if (nextOpen == null) {
    next.quietSince = null
  }

  val settled = sample.t - startedAtMs >= config.jerkSettleMs
  if (!settled || next.baseline == null) {
    next.candidateSince = null
    return HandheldStep(next, nextOpen, emitted, nextClosedAt)
  }

  val tilt = gravityTiltDeg(next.baseline, gravity)

  if (nextOpen != null) {
    val openEvent = nextOpen
    if (tilt > openEvent.peak) {
      openEvent.peak = tilt
      openEvent.severity = severityFromPeak(tilt, config.handheldTiltDeg)
      openEvent.level = harshEventLevel(
        tilt,
        config.handheldTiltDeg,
        config.harshMediumX,
        config.harshHeavyX,
      )
      openEvent.lat = location?.lat ?: openEvent.lat
      openEvent.lon = location?.lon ?: openEvent.lon
      openEvent.speedMps = speedMps
      emitted = openEvent
    }
    val shouldExit = !moving || tilt < config.handheldExitTiltDeg
    if (shouldExit) {
      if (next.belowExitSince == null) {
        next.belowExitSince = sample.t
      }
      if (sample.t - (next.belowExitSince ?: sample.t) >= config.handheldExitMs) {
        openEvent.endT = sample.t
        nextClosedAt = sample.t
        emitted = openEvent
        nextOpen = null
        next.candidateSince = null
        next.belowExitSince = null
        next.quietSince = null
      }
    } else {
      next.belowExitSince = null
    }
    return HandheldStep(next, nextOpen, emitted, nextClosedAt)
  }

  if (!moving) {
    next.candidateSince = null
    next.belowExitSince = null
    return HandheldStep(next, nextOpen, emitted, nextClosedAt)
  }

  if (nextClosedAt != null && sample.t - nextClosedAt < config.handheldCooldownMs) {
    next.candidateSince = null
    return HandheldStep(next, nextOpen, emitted, nextClosedAt)
  }

  val handling =
    gyroMag >= config.handheldGyroRadps || linearMag >= config.handheldMotionMps2
  if (tilt >= config.handheldTiltDeg && handling && next.candidateSince == null) {
    next.candidateSince = sample.t
  }
  if (next.candidateSince != null && tilt >= config.handheldTiltDeg) {
    if (sample.t - (next.candidateSince ?: sample.t) >= config.handheldConfirmMs) {
      val opened = DrivingEvent(
        id = "$PHONE_HANDHELD_TYPE-${sample.t}",
        type = PHONE_HANDHELD_TYPE,
        t = next.candidateSince ?: sample.t,
        endT = null,
        peak = tilt,
        severity = severityFromPeak(tilt, config.handheldTiltDeg),
        level = harshEventLevel(
          tilt,
          config.handheldTiltDeg,
          config.harshMediumX,
          config.harshHeavyX,
        ),
        lat = location?.lat,
        lon = location?.lon,
        speedMps = speedMps,
      )
      nextOpen = opened
      emitted = opened
      next.candidateSince = null
      next.belowExitSince = null
    }
  } else {
    next.candidateSince = null
  }

  return HandheldStep(next, nextOpen, emitted, nextClosedAt)
}

internal fun closeHandheldSpan(open: DrivingEvent?, t: Double): DrivingEvent? {
  if (open == null || open.endT != null) {
    return null
  }
  open.endT = t
  return open
}
