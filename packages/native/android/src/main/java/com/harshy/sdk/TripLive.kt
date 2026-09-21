package com.harshy.sdk

import com.harshy.engine.TripLiveDisplay
import com.harshy.engine.TripLivePayload
import kotlin.math.roundToInt
import java.util.Locale

fun tripLivePayloadFromMap(raw: Map<String, Any?>, fallbackTitle: String): TripLivePayload {
  fun text(key: String, fallback: String): String {
    val value = raw[key]
    return when (value) {
      null -> fallback
      is String -> value.ifBlank { fallback }
      else -> value.toString()
    }
  }
  return TripLivePayload(
    title = text("title", fallbackTitle),
    score = text("score", "—"),
    speed = text("speed", "—"),
    duration = text("duration", "0:00"),
    distance = text("distance", "—"),
  )
}

internal fun tripLivePayloadFromMetrics(metrics: LiveMetrics, title: String): TripLivePayload {
  val speed = metrics.speedKmh?.let { "${it.roundToInt()} km/h" } ?: "—"
  val distanceKm = metrics.distanceM / 1000.0
  val distance = if (distanceKm < 10) {
    String.format(Locale.US, "%.2f km", distanceKm)
  } else {
    String.format(Locale.US, "%.1f km", distanceKm)
  }
  return TripLivePayload(
    title = title,
    score = metrics.score.roundToInt().toString(),
    speed = speed,
    duration = formatTripDuration(metrics.durationMs),
    distance = distance,
  )
}

internal fun formatTripDuration(ms: Double): String {
  val total = maxOf(0, (ms / 1000.0).toInt())
  val hours = total / 3600
  val minutes = (total % 3600) / 60
  val seconds = total % 60
  return if (hours > 0) {
    String.format(Locale.US, "%d:%02d:%02d", hours, minutes, seconds)
  } else {
    String.format(Locale.US, "%d:%02d", minutes, seconds)
  }
}

internal fun publishTripLive(context: android.content.Context, metrics: LiveMetrics) {
  val label = context.applicationInfo.loadLabel(context.packageManager)?.toString().orEmpty()
    .ifBlank { "Harshy" }
  TripLiveDisplay.update(context, tripLivePayloadFromMetrics(metrics, label))
}
