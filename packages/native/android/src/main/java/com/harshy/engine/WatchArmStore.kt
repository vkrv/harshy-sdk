package com.harshy.engine

import android.content.Context
import org.json.JSONObject
import java.io.File

/**
 * Remembers that Auto MotionWatch was armed so a process kill can restore the
 * location foreground service without waiting for JS to open the host app.
 */
internal class WatchArmStore(context: Context) {
  private val dir = File(context.filesDir, "harshy-watch")
  private val file = File(dir, "armed.json")
  private val lock = Any()

  fun isArmed(): Boolean {
    synchronized(lock) {
      if (!file.exists()) {
        return false
      }
      return try {
        JSONObject(file.readText()).optBoolean("armed", false)
      } catch (_: Exception) {
        false
      }
    }
  }

  fun markArmed() {
    synchronized(lock) {
      dir.mkdirs()
      file.writeText(JSONObject().put("armed", true).toString())
    }
  }

  fun clear() {
    synchronized(lock) {
      if (file.exists()) {
        file.delete()
      }
      if (dir.exists()) {
        dir.deleteRecursively()
      }
    }
  }
}

/** Pure gate for sticky FGS restore after process death. */
internal object WatchArmRestore {
  fun shouldRestore(armedOnDisk: Boolean, running: Boolean, alreadyWatching: Boolean): Boolean {
    return armedOnDisk && !running && !alreadyWatching
  }
}
