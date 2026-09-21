package com.harshy.sdk

import kotlin.math.abs
import kotlin.math.exp

internal const val HEADING_CONFIRM_SAMPLES = 2
internal const val HEADING_CONFIRM_BAND_DEG = 35.0
internal const val HEADING_SMOOTH_TAU_MS = 800.0
internal const val HEADING_PUBLISH_DEG = 3.0

internal data class HeadingFilter(
  val headingDeg: Double? = null,
  val smoothedDeg: Double? = null,
  val atMs: Double? = null,
  val pendingDeg: Double? = null,
  val pendingCount: Int = 0,
  val held: Boolean = false,
)

internal fun wrapCourseDeg(deg: Double): Double {
  var wrapped = deg % 360.0
  if (wrapped < 0) {
    wrapped += 360.0
  }
  return wrapped
}

internal fun advanceHeadingFilter(
  prev: HeadingFilter,
  sample: LocationSample,
  minSpeedMps: Double,
): HeadingFilter {
  val course = sample.courseDeg ?: return prev
  if (!course.isFinite()) {
    return prev
  }
  val courseDeg = wrapCourseDeg(course)
  val speed = sample.speedMps
  val moving = speed != null && speed >= minSpeedMps
  if (!moving) {
    return HeadingFilter(
      headingDeg = prev.headingDeg,
      smoothedDeg = prev.smoothedDeg,
      atMs = prev.atMs,
      pendingDeg = null,
      pendingCount = 0,
      held = prev.headingDeg != null,
    )
  }

  val needsConfirm = prev.headingDeg == null || prev.held
  if (needsConfirm) {
    val stepped = stepConfirm(prev.pendingDeg, prev.pendingCount, courseDeg)
    val confirmed = stepped.confirmedDeg ?: return prev.copy(
      pendingDeg = stepped.pendingDeg,
      pendingCount = stepped.pendingCount,
    )
    return HeadingFilter(
      headingDeg = maybePublish(prev.headingDeg, confirmed),
      smoothedDeg = confirmed,
      atMs = sample.t,
      pendingDeg = null,
      pendingCount = 0,
      held = false,
    )
  }

  val from = prev.smoothedDeg ?: prev.headingDeg ?: courseDeg
  val dtMs = if (prev.atMs == null) HEADING_SMOOTH_TAU_MS else maxOf(0.0, sample.t - prev.atMs)
  val smoothedDeg = smoothToward(from, courseDeg, dtMs)
  return HeadingFilter(
    headingDeg = maybePublish(prev.headingDeg, smoothedDeg),
    smoothedDeg = smoothedDeg,
    atMs = sample.t,
    pendingDeg = null,
    pendingCount = 0,
    held = false,
  )
}

private data class ConfirmStep(
  val pendingDeg: Double,
  val pendingCount: Int,
  val confirmedDeg: Double?,
)

private fun stepConfirm(
  pendingDeg: Double?,
  pendingCount: Int,
  courseDeg: Double,
): ConfirmStep {
  if (pendingDeg == null || pendingCount <= 0) {
    return ConfirmStep(courseDeg, 1, null)
  }
  val delta = unwrapDeltaDeg(pendingDeg, courseDeg)
  if (abs(delta) > HEADING_CONFIRM_BAND_DEG) {
    return ConfirmStep(courseDeg, 1, null)
  }
  val blended = wrapCourseDeg(pendingDeg + delta / 2)
  val count = pendingCount + 1
  if (count < HEADING_CONFIRM_SAMPLES) {
    return ConfirmStep(blended, count, null)
  }
  return ConfirmStep(blended, 0, blended)
}

private fun smoothToward(fromDeg: Double, toDeg: Double, dtMs: Double): Double {
  val alpha = if (dtMs <= 0) 1.0 else 1.0 - exp(-dtMs / HEADING_SMOOTH_TAU_MS)
  return wrapCourseDeg(fromDeg + alpha * unwrapDeltaDeg(fromDeg, toDeg))
}

private fun maybePublish(published: Double?, smoothed: Double): Double {
  if (published == null) {
    return smoothed
  }
  if (abs(unwrapDeltaDeg(published, smoothed)) >= HEADING_PUBLISH_DEG) {
    return smoothed
  }
  return published
}
