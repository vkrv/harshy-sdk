package com.harshy.sdk

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

internal fun isoFromEpochMs(ms: Double): String {
  val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
  sdf.timeZone = TimeZone.getTimeZone("UTC")
  return sdf.format(Date(ms.toLong()))
}

internal fun Any?.asDouble(): Double? {
  return when (this) {
    null -> null
    is Double -> this
    is Float -> toDouble()
    is Int -> toDouble()
    is Long -> toDouble()
    is Number -> toDouble()
    is String -> this.toDoubleOrNull()
    else -> null
  }
}

internal fun Any?.asString(): String? = this as? String

@Suppress("UNCHECKED_CAST")
internal fun parseVec(value: Any?): Vec3? {
  val map = value as? Map<*, *> ?: return null
  val x = map["x"].asDouble() ?: return null
  val y = map["y"].asDouble() ?: 0.0
  val z = map["z"].asDouble() ?: 0.0
  return Vec3(x, y, z)
}

@Suppress("UNCHECKED_CAST")
internal fun parseAttitude(value: Any?): Attitude? {
  val map = value as? Map<*, *> ?: return null
  val pitch = map["pitch"].asDouble() ?: return null
  val roll = map["roll"].asDouble() ?: 0.0
  val yaw = map["yaw"].asDouble() ?: 0.0
  return Attitude(pitch, roll, yaw)
}

@Suppress("UNCHECKED_CAST")
fun parseLocationSample(raw: Map<String, Any?>): LocationSample? {
  val t = raw["t"].asDouble() ?: return null
  val lat = raw["lat"].asDouble() ?: return null
  val lon = raw["lon"].asDouble() ?: return null
  return LocationSample(
    t = t,
    lat = lat,
    lon = lon,
    altitudeM = raw["altitudeM"].asDouble(),
    speedMps = raw["speedMps"].asDouble(),
    courseDeg = raw["courseDeg"].asDouble(),
    accuracyM = raw["accuracyM"].asDouble(),
    altitudeAccuracyM = raw["altitudeAccuracyM"].asDouble(),
    roadRmsMps2 = raw["roadRmsMps2"].asDouble(),
  )
}

@Suppress("UNCHECKED_CAST")
fun parseImuSample(raw: Map<String, Any?>): ImuSample? {
  val t = raw["t"].asDouble() ?: return null
  val accel = parseVec(raw["accel"]) ?: return null
  return ImuSample(
    t = t,
    accel = accel,
    linearAccel = parseVec(raw["linearAccel"]),
    gyro = parseVec(raw["gyro"]),
    magnetometer = parseVec(raw["magnetometer"]),
    attitude = parseAttitude(raw["attitude"]),
    gravity = parseVec(raw["gravity"]),
    barometerHpa = raw["barometerHpa"].asDouble(),
  )
}

@Suppress("UNCHECKED_CAST")
internal fun parseLocationList(value: Any?): List<LocationSample> {
  val list = value as? List<*> ?: return emptyList()
  return list.mapNotNull { item ->
    val map = item as? Map<*, *> ?: return@mapNotNull null
    parseLocationSample(map as Map<String, Any?>)
  }
}

@Suppress("UNCHECKED_CAST")
internal fun parseImuList(value: Any?): List<ImuSample> {
  val list = value as? List<*> ?: return emptyList()
  return list.mapNotNull { item ->
    val map = item as? Map<*, *> ?: return@mapNotNull null
    parseImuSample(map as Map<String, Any?>)
  }
}

internal fun newSessionId(): String {
  return "trip-${System.currentTimeMillis()}-${Integer.toHexString((Math.random() * 0xffff).toInt())}"
}
