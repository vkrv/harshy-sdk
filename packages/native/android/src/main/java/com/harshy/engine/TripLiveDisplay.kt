package com.harshy.engine

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/** Ongoing trip notification content (Android Live Activity equivalent). */
data class TripLivePayload(
  val title: String,
  val score: String,
  val speed: String,
  val duration: String,
  val distance: String,
) {
  fun line(): String = "Score $score · $speed · $duration · $distance"
}

object TripLiveDisplay {
  const val CHANNEL_ID = "harshy-trip"
  const val NOTIFICATION_ID = 4217
  private const val TAG = "HarshyTripLive"

  @Volatile
  private var lastPayload: TripLivePayload? = null

  @Volatile
  private var lastNotifyElapsedMs: Long = 0L

  fun lastPayloadOrDefault(appLabel: String): TripLivePayload {
    return lastPayload ?: TripLivePayload(
      title = appLabel,
      score = "—",
      speed = "—",
      duration = "0:00",
      distance = "—",
    )
  }

  fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    val channel = NotificationChannel(
      CHANNEL_ID,
      "Driving sessions",
      NotificationManager.IMPORTANCE_LOW,
    )
    channel.setShowBadge(false)
    manager.createNotificationChannel(channel)
  }

  fun buildNotification(context: Context, payload: TripLivePayload): Notification {
    ensureChannel(context)
    val label = payload.title.ifBlank {
      context.applicationInfo.loadLabel(context.packageManager)?.toString().orEmpty().ifBlank { "Harshy" }
    }
    return NotificationCompat.Builder(context, CHANNEL_ID)
      .setContentTitle(label)
      .setContentText(payload.line())
      .setStyle(NotificationCompat.BigTextStyle().bigText(payload.line()))
      .setSmallIcon(smallIcon(context))
      .setContentIntent(launchAppIntent(context))
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setCategory(NotificationCompat.CATEGORY_NAVIGATION)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .build()
  }

  /**
   * Update the sticky trip notification. Throttled to ~1 Hz unless [force].
   */
  fun update(context: Context, payload: TripLivePayload, force: Boolean = false) {
    lastPayload = payload
    val now = SystemClock.elapsedRealtime()
    if (!force && now - lastNotifyElapsedMs < 900L) {
      return
    }
    lastNotifyElapsedMs = now
    try {
      val notification = buildNotification(context, payload)
      NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
    } catch (error: SecurityException) {
      // POST_NOTIFICATIONS denied — FGS may still hold the initial notice.
      Log.w(TAG, "notify blocked", error)
    } catch (error: Exception) {
      Log.w(TAG, "notify failed", error)
    }
  }

  fun clearCache() {
    lastPayload = null
    lastNotifyElapsedMs = 0L
  }

  /** Prefer merged `harshy_trip_notification`; fall back so host/unit builds need no Expo R. */
  private fun smallIcon(context: Context): Int {
    val id = context.resources.getIdentifier(
      "harshy_trip_notification",
      "drawable",
      context.packageName,
    )
    return if (id != 0) id else android.R.drawable.ic_menu_mylocation
  }

  private fun launchAppIntent(context: Context): PendingIntent? {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
    launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
    return PendingIntent.getActivity(context, 0, launch, flags)
  }
}
