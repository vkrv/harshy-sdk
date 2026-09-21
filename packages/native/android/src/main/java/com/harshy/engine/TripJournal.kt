package com.harshy.engine

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedWriter
import java.io.File
import java.io.FileOutputStream
import java.io.OutputStreamWriter
import java.util.ArrayDeque

/**
 * On-disk copy of an in-progress Android trip so a process kill does not drop the track.
 * Location is the path; IMU is restored in the background after capture resumes.
 * Files are capped to the same ring sizes as in-RAM buffers.
 *
 * Compaction is amortized (slack) and streamed to a temp file — never rewrite a
 * ~100 MB JSONL on every overflow sample (that OOMs mid multi-hour trips).
 */
internal class TripJournal(context: Context) {
  private val dir = File(context.filesDir, "harshy-trip")
  private val metaFile = File(dir, "meta.json")
  private val locationFile = File(dir, "location.jsonl")
  private val imuFile = File(dir, "imu.jsonl")
  private val lock = Any()

  private var locationWriter: BufferedWriter? = null
  private var imuWriter: BufferedWriter? = null
  private var locationLines = 0
  private var imuLines = 0

  data class Meta(
    val sessionId: String,
    val startedAtMs: Long,
    val imuHz: Int,
    val locationIntervalMs: Long,
    val background: Boolean,
    val trigger: String = "manual",
  )

  data class Loaded(
    val meta: Meta,
    val location: List<Map<String, Any?>>,
    val imu: List<Map<String, Any?>>,
  )

  fun begin(meta: Meta) {
    synchronized(lock) {
      closeWritersLocked()
      if (dir.exists()) {
        dir.deleteRecursively()
      }
      dir.mkdirs()
      metaFile.writeText(tripJournalMetaToJson(meta).toString())
      locationWriter = openAppendWriter(locationFile)
      imuWriter = openAppendWriter(imuFile)
      locationLines = 0
      imuLines = 0
    }
  }

  /**
   * Re-open writers after process death and recount lines so trim slack is accurate.
   * Streaming count — does not hold the file contents in RAM.
   */
  fun resumeWriters() {
    synchronized(lock) {
      closeWritersLocked()
      locationLines = countNonBlankLines(locationFile)
      imuLines = countNonBlankLines(imuFile)
      if (locationFile.exists() || metaFile.exists()) {
        dir.mkdirs()
        locationWriter = openAppendWriter(locationFile)
        imuWriter = openAppendWriter(imuFile)
      }
    }
  }

  fun appendLocation(sample: Map<String, Any?>) {
    appendLine(locationFile, ::locationWriter, sample) { locationLines += 1 }
  }

  fun appendImu(sample: Map<String, Any?>) {
    appendLine(imuFile, ::imuWriter, sample) { imuLines += 1 }
  }

  fun trimLocation(maxLines: Int) {
    trimFile(locationFile, maxLines, { locationLines }) { locationLines = it }
  }

  fun trimImu(maxLines: Int) {
    trimFile(imuFile, maxLines, { imuLines }) { imuLines = it }
  }

  fun flush() {
    synchronized(lock) {
      try {
        locationWriter?.flush()
        imuWriter?.flush()
      } catch (_: Exception) {
      }
    }
  }

  fun loadMeta(): Meta? {
    synchronized(lock) {
      if (!metaFile.exists()) {
        return null
      }
      return try {
        tripJournalMetaFromJson(JSONObject(metaFile.readText()))
      } catch (_: Exception) {
        null
      }
    }
  }

  fun loadLocation(maxLines: Int = TripIdleGate.MAX_LOCATION_SAMPLES): List<Map<String, Any?>> {
    return loadJsonl(locationFile, maxLines)
  }

  fun loadImu(maxLines: Int): List<Map<String, Any?>> {
    return loadJsonl(imuFile, maxLines)
  }

  fun load(): Loaded? {
    val meta = loadMeta() ?: return null
    return Loaded(
      meta,
      loadLocation(TripIdleGate.MAX_LOCATION_SAMPLES),
      loadImu(TripIdleGate.maxImuSamples(meta.imuHz)),
    )
  }

  fun clear() {
    synchronized(lock) {
      closeWritersLocked()
      if (dir.exists()) {
        dir.deleteRecursively()
      }
      locationLines = 0
      imuLines = 0
    }
  }

  private fun appendLine(
    file: File,
    writerProp: () -> BufferedWriter?,
    sample: Map<String, Any?>,
    onAppend: () -> Unit,
  ) {
    synchronized(lock) {
      dir.mkdirs()
      var writer = writerProp()
      if (writer == null) {
        when (file) {
          locationFile -> {
            locationWriter = openAppendWriter(file)
            writer = locationWriter
          }
          imuFile -> {
            imuWriter = openAppendWriter(file)
            writer = imuWriter
          }
        }
      }
      try {
        writer?.append(mapToJson(sample).toString())
        writer?.newLine()
        onAppend()
      } catch (_: Exception) {
      }
    }
  }

  private fun trimFile(
    file: File,
    maxLines: Int,
    getCount: () -> Int,
    setCount: (Int) -> Unit,
  ) {
    synchronized(lock) {
      if (maxLines <= 0) {
        closeWritersLocked()
        if (file.exists()) {
          file.delete()
        }
        setCount(0)
        reopenWriter(file)
        return
      }
      if (!file.exists()) {
        setCount(0)
        return
      }
      var count = getCount()
      if (count <= 0) {
        count = countNonBlankLines(file)
        setCount(count)
      }
      // Amortize: only compact once the file grows past max + slack.
      val slack = ringSlack(maxLines)
      if (count <= maxLines + slack) {
        return
      }
      val skip = count - maxLines
      val tmp = File(file.parentFile, "${file.name}.tmp")
      closeWriterFor(file)
      try {
        var skipped = 0
        var kept = 0
        tmp.bufferedWriter(Charsets.UTF_8, 32 * 1024).use { out ->
          file.forEachLine { line ->
            if (line.isBlank()) {
              return@forEachLine
            }
            if (skipped < skip) {
              skipped += 1
              return@forEachLine
            }
            out.append(line)
            out.newLine()
            kept += 1
          }
        }
        if (!tmp.renameTo(file)) {
          tmp.copyTo(file, overwrite = true)
          tmp.delete()
        }
        setCount(kept)
      } catch (_: Exception) {
        if (tmp.exists()) {
          tmp.delete()
        }
      }
      reopenWriter(file)
    }
  }

  private fun loadJsonl(file: File, maxLines: Int): List<Map<String, Any?>> {
    synchronized(lock) {
      if (!file.exists() || maxLines <= 0) {
        return emptyList()
      }
      // Keep only the last `maxLines` as we scan — never materialize the whole file.
      val ring = ArrayDeque<String>(maxLines.coerceAtMost(4096).coerceAtLeast(16))
      try {
        file.forEachLine { line ->
          if (line.isBlank()) {
            return@forEachLine
          }
          if (ring.size >= maxLines) {
            ring.removeFirst()
          }
          ring.addLast(line)
        }
      } catch (_: Exception) {
        return emptyList()
      }
      val out = ArrayList<Map<String, Any?>>(ring.size)
      for (line in ring) {
        try {
          @Suppress("UNCHECKED_CAST")
          out.add(fromJson(JSONObject(line)) as Map<String, Any?>)
        } catch (_: Exception) {
        }
      }
      return out
    }
  }

  private fun countNonBlankLines(file: File): Int {
    if (!file.exists()) {
      return 0
    }
    var count = 0
    try {
      file.forEachLine { line ->
        if (line.isNotBlank()) {
          count += 1
        }
      }
    } catch (_: Exception) {
      return 0
    }
    return count
  }

  private fun ringSlack(maxLines: Int): Int {
    if (maxLines < 50) {
      return 0
    }
    return maxOf(1, maxLines / 50)
  }

  private fun openAppendWriter(file: File): BufferedWriter {
    if (!file.exists()) {
      file.parentFile?.mkdirs()
      file.createNewFile()
    }
    return BufferedWriter(OutputStreamWriter(FileOutputStream(file, true), Charsets.UTF_8), 32 * 1024)
  }

  private fun reopenWriter(file: File) {
    when (file) {
      locationFile -> locationWriter = openAppendWriter(file)
      imuFile -> imuWriter = openAppendWriter(file)
    }
  }

  private fun closeWriterFor(file: File) {
    try {
      when (file) {
        locationFile -> {
          locationWriter?.flush()
          locationWriter?.close()
          locationWriter = null
        }
        imuFile -> {
          imuWriter?.flush()
          imuWriter?.close()
          imuWriter = null
        }
      }
    } catch (_: Exception) {
    }
  }

  private fun closeWritersLocked() {
    try {
      locationWriter?.flush()
      locationWriter?.close()
    } catch (_: Exception) {
    }
    try {
      imuWriter?.flush()
      imuWriter?.close()
    } catch (_: Exception) {
    }
    locationWriter = null
    imuWriter = null
  }
}

internal fun parseTripTrigger(value: String?): String {
  return if (value == "auto") "auto" else "manual"
}

internal fun tripJournalMetaPayload(meta: TripJournal.Meta): Map<String, Any> {
  return mapOf(
    "active" to true,
    "sessionId" to meta.sessionId,
    "startedAtMs" to meta.startedAtMs,
    "imuHz" to meta.imuHz,
    "locationIntervalMs" to meta.locationIntervalMs,
    "background" to meta.background,
    "trigger" to parseTripTrigger(meta.trigger),
  )
}

internal fun tripJournalMetaFromFields(
  active: Boolean,
  sessionId: String?,
  startedAtMs: Long,
  imuHz: Int,
  locationIntervalMs: Long,
  background: Boolean,
  trigger: String?,
): TripJournal.Meta? {
  if (!active) {
    return null
  }
  if (sessionId.isNullOrEmpty()) {
    return null
  }
  return TripJournal.Meta(
    sessionId = sessionId,
    startedAtMs = startedAtMs,
    imuHz = imuHz,
    locationIntervalMs = locationIntervalMs,
    background = background,
    trigger = parseTripTrigger(trigger),
  )
}

internal fun tripJournalMetaToJson(meta: TripJournal.Meta): JSONObject {
  val json = JSONObject()
  for ((key, value) in tripJournalMetaPayload(meta)) {
    json.put(key, value)
  }
  return json
}

internal fun tripJournalMetaFromJson(json: JSONObject): TripJournal.Meta? {
  return tripJournalMetaFromFields(
    active = json.optBoolean("active", false),
    sessionId = json.optString("sessionId"),
    startedAtMs = json.optLong("startedAtMs"),
    imuHz = json.optInt("imuHz", 25),
    locationIntervalMs = json.optLong("locationIntervalMs", 500L),
    background = json.optBoolean("background", true),
    trigger = json.optString("trigger"),
  )
}

internal fun mapToJson(value: Map<String, Any?>): JSONObject {
  val obj = JSONObject()
  for ((key, item) in value) {
    obj.put(key, toJson(item))
  }
  return obj
}

private fun toJson(value: Any?): Any {
  return when (value) {
    null -> JSONObject.NULL
    is Map<*, *> -> {
      val obj = JSONObject()
      for ((key, item) in value) {
        if (key is String) {
          obj.put(key, toJson(item))
        }
      }
      obj
    }
    is Iterable<*> -> {
      val array = JSONArray()
      for (item in value) {
        array.put(toJson(item))
      }
      array
    }
    is Boolean, is Number, is String -> value
    else -> value.toString()
  }
}

private fun fromJson(value: Any?): Any? {
  return when (value) {
    null, JSONObject.NULL -> null
    is JSONObject -> {
      val map = LinkedHashMap<String, Any?>()
      val keys = value.keys()
      while (keys.hasNext()) {
        val key = keys.next()
        map[key] = fromJson(value.opt(key))
      }
      map
    }
    is JSONArray -> {
      val list = ArrayList<Any?>(value.length())
      for (index in 0 until value.length()) {
        list.add(fromJson(value.opt(index)))
      }
      list
    }
    is Int -> value.toLong()
    else -> value
  }
}
