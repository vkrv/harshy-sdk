package com.harshy.sdk

import android.location.Location
import android.os.Build

/**
 * GPS sample from a platform [Location]. [tMs] is the capture time from the trip's [HarshyClock],
 * not `Location.time`: GNSS time can drift from the IMU clock and break road RMS alignment.
 */
fun Location.toLocationSample(tMs: Long): LocationSample {
  return LocationSample(
    t = tMs.toDouble(),
    lat = latitude,
    lon = longitude,
    altitudeM = altitude,
    speedMps = if (hasSpeed()) speed.toDouble() else null,
    courseDeg = if (hasBearing()) bearing.toDouble() else null,
    accuracyM = if (hasAccuracy()) accuracy.toDouble() else null,
    altitudeAccuracyM = if (Build.VERSION.SDK_INT >= 26 && hasVerticalAccuracy()) {
      verticalAccuracyMeters.toDouble()
    } else {
      null
    },
  )
}

/** Vector from a `SensorEvent.values` copy. Missing axes read as 0. */
fun FloatArray.toVec3(): Vec3 {
  return Vec3(
    x = if (size > 0) this[0].toDouble() else 0.0,
    y = if (size > 1) this[1].toDouble() else 0.0,
    z = if (size > 2) this[2].toDouble() else 0.0,
  )
}

/**
 * IMU sample from the latest sensor readings, or null until an accelerometer reading exists.
 * Pass `SensorEvent.values` copies; the detector reads accel, linearAccel, gyro and gravity.
 */
fun imuSampleOf(
  tMs: Long,
  accel: FloatArray?,
  linearAccel: FloatArray? = null,
  gyro: FloatArray? = null,
  gravity: FloatArray? = null,
  magnetometer: FloatArray? = null,
): ImuSample? {
  val accelVec = accel?.toVec3() ?: return null
  return ImuSample(
    t = tMs.toDouble(),
    accel = accelVec,
    linearAccel = linearAccel?.toVec3(),
    gyro = gyro?.toVec3(),
    magnetometer = magnetometer?.toVec3(),
    gravity = gravity?.toVec3(),
  )
}
