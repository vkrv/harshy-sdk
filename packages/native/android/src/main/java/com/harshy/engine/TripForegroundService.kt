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
      val label = applicationInfo.loadLabel(packageManager)?.toString().orEmpty().ifBlank { "Apexmatic" }
      val engine = HarshyEngine.shared(this)
      // Sticky restart after process death: restore watch preference before the first notice.
      if (!engine.isRunning()) {
        engine.restoreWatchIfNeeded(fromService = true)
      }
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
      val restoredTrip = engine.restoreIfNeeded(fromService = true)
      if (!restoredTrip && !engine.isRunning()) {
        engine.restoreWatchIfNeeded(fromService = true)
      }
      if (tripNoticeKind(engine.isRunning(), engine.isWatching()) == TripNoticeKind.None) {
        retireIdleNotice()
        // START_STICKY here would recreate the service and post the last score again.
        START_NOT_STICKY
      } else {
        START_STICKY
      }
    } catch (error: Exception) {
      Log.e(TAG, "onStartCommand failed", error)
      try {
        stopForeground(STOP_FOREGROUND_REMOVE)
      } catch (_: Exception) {
      }
      TripLiveDisplay.dismiss(this)
      stopSelf()
      START_NOT_STICKY
    }
  }

  /** Drop the score chip and the shade card, then stop. */
  private fun retireIdleNotice() {
    try {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } catch (_: Exception) {
    }
    TripLiveDisplay.dismiss(this)
    stopSelf()
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    // Keep capturing after the task is swiped away; stop() tears the service down.
  }

  override fun onDestroy() {
    val engine = HarshyEngine.shared(this)
    val idle = tripNoticeKind(engine.isRunning(), engine.isWatching()) == TripNoticeKind.None
    try {
      // A live trip or watch keeps its notice for the restart. An idle stop removes it.
      stopForeground(if (idle) STOP_FOREGROUND_REMOVE else STOP_FOREGROUND_DETACH)
    } catch (_: Exception) {
    }
    if (idle) {
      TripLiveDisplay.dismiss(this)
    }
    engine.markForegroundServiceStopped()
    super.onDestroy()
  }

  companion object {
    private const val TAG = "HarshyTripFgs"
  }
}
