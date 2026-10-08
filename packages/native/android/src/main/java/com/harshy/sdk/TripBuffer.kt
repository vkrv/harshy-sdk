package com.harshy.sdk

/** Matches `@harshy/core` tripBuffer: caps on what one analyzer keeps in memory. */
const val MAX_LOCATION_SAMPLES = 20_000
const val MAX_IMU_MINUTES = 120
internal const val RING_TRIM_SLACK_FRACTION = 0.02
internal const val DEFAULT_ANALYZER_IMU_HZ = 50

/** Default IMU ring size for [imuHz]: [MAX_IMU_MINUTES] of samples. */
fun maxImuSamples(imuHz: Int): Int {
  val hz = if (imuHz > 0) imuHz else DEFAULT_ANALYZER_IMU_HZ
  return hz * 60 * MAX_IMU_MINUTES
}

/** Length to trim an overflowing buffer of cap [max] down to: 2% below it, so the next drop is amortized. */
internal fun ringTrimTarget(max: Int): Int {
  val slack = if (max < 50) 0 else maxOf(1, (max * RING_TRIM_SLACK_FRACTION).toInt())
  return maxOf(0, max - slack)
}

/** Drops the oldest items past [max], in chunks so the next overflow is amortized. */
internal fun <T> trimRingBuffer(items: ArrayDeque<T>, max: Int) {
  if (max <= 0) {
    items.clear()
    return
  }
  if (items.size <= max) {
    return
  }
  repeat(items.size - ringTrimTarget(max)) { items.removeFirst() }
}
