package com.harshy.engine

/**
 * Android 12+ throws [android.app.ForegroundServiceStartNotAllowedException] when a
 * backgrounded app calls `startForegroundService`, including right after an automatic
 * trip end. If the location service is already in the foreground, keep it and swap
 * the notification instead of stopping and starting it.
 */
internal object ForegroundServiceHandoff {
  fun keepRunning(handoffToWatch: Boolean, serviceAlreadyStarted: Boolean): Boolean {
    return handoffToWatch && serviceAlreadyStarted
  }

  fun shouldStartService(serviceAlreadyStarted: Boolean): Boolean {
    return !serviceAlreadyStarted
  }
}
