package com.harshy.engine

import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log

class TripForegroundService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    // Must call startForeground promptly after startForegroundService or the OS kills the app.
    try {
      val label = applicationInfo.loadLabel(packageManager)?.toString().orEmpty().ifBlank { "Signumb" }
      val engine = HarshyEngine.shared(this)
      val notification = if (engine.isWatching() && !engine.isRunning()) {
        TripLiveDisplay.buildWatchNotification(this, label)
      } else {
        TripLiveDisplay.buildNotification(this, TripLiveDisplay.lastPayloadOrDefault(label).copy(title = label))
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(
          TripLiveDisplay.NOTIFICATION_ID,
          notification,
          android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION,
        )
      } else {
        startForeground(TripLiveDisplay.NOTIFICATION_ID, notification)
      }
      engine.markForegroundServiceStarted()
    } catch (error: Exception) {
      Log.e(TAG, "startForeground failed", error)
      try {
        stopSelf()
      } catch (_: Exception) {
      }
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    return try {
      val engine = HarshyEngine.shared(this)
      val restored = engine.restoreIfNeeded(fromService = true)
      if (!restored && !engine.isRunning() && !engine.isWatching()) {
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
      }
      START_STICKY
    } catch (error: Exception) {
      Log.e(TAG, "onStartCommand failed", error)
      try {
        stopForeground(STOP_FOREGROUND_REMOVE)
      } catch (_: Exception) {
      }
      stopSelf()
      START_NOT_STICKY
    }
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    // Keep capturing after the task is swiped away; stop() tears the service down.
  }

  override fun onDestroy() {
    HarshyEngine.shared(this).markForegroundServiceStopped()
    TripLiveDisplay.clearCache()
    super.onDestroy()
  }

  companion object {
    private const val TAG = "HarshyTripFgs"
  }
}
