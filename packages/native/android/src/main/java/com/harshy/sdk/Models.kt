package com.harshy.sdk

data class Vec3(
  val x: Double,
  val y: Double,
  val z: Double,
)

data class Attitude(
  val pitch: Double,
  val roll: Double,
  val yaw: Double,
)

data class LocationSample(
  val t: Double,
  val lat: Double,
  val lon: Double,
  val altitudeM: Double? = null,
  val speedMps: Double? = null,
  val courseDeg: Double? = null,
  val accuracyM: Double? = null,
  val altitudeAccuracyM: Double? = null,
  val roadRmsMps2: Double? = null,
)

data class ImuSample(
  val t: Double,
  val accel: Vec3,
  val linearAccel: Vec3? = null,
  val gyro: Vec3? = null,
  val magnetometer: Vec3? = null,
  val attitude: Attitude? = null,
  val gravity: Vec3? = null,
  val barometerHpa: Double? = null,
)

data class DeviceInfo(
  val platform: String,
  val model: String? = null,
)

data class LiveMetrics(
  val t: Double,
  val speedMps: Double?,
  val speedKmh: Double?,
  val headingDeg: Double?,
  val altitudeM: Double?,
  val locationAccuracyM: Double?,
  val longitudinalAccelMps2: Double?,
  val lateralAccelMps2: Double?,
  val verticalAccelMps2: Double?,
  val accelMagnitudeMps2: Double?,
  val gyroMagnitudeRadps: Double?,
  val accelLevel: String,
  val brakeLevel: String,
  val cornerLevel: String,
  val yawRateRadps: Double?,
  val swerveLevel: String,
  val distanceM: Double,
  val durationMs: Double,
  val score: Double,
)

data class TripMetrics(
  val distanceM: Double,
  val durationMs: Double,
  val maxSpeedMps: Double?,
  val avgSpeedMps: Double?,
  val score: Double,
  val eventCounts: Map<String, Int>,
)

data class SessionExport(
  val schemaVersion: Int = 1,
  val sessionId: String,
  val startedAt: String,
  val endedAt: String?,
  val config: DetectorConfig,
  val location: List<LocationSample>,
  val imu: List<ImuSample>,
  val events: List<DrivingEvent>,
  val metrics: TripMetrics,
  val device: DeviceInfo,
  val trigger: String = "manual",
)

data class ClientState(
  val running: Boolean,
  val source: String,
  val sessionId: String?,
)

data class NativeStartOptions(
  val imuHz: Int = 50,
  val locationIntervalMs: Long = 500,
  val background: Boolean = true,
  val trigger: String = "manual",
)

/** Mutable so cooldown upgrades and compound tags match the JS analyzer. */
class DrivingEvent(
  val id: String,
  val type: String,
  val t: Double,
  var endT: Double? = null,
  var peak: Double,
  var severity: Double,
  var level: String,
  var lat: Double?,
  var lon: Double?,
  var speedMps: Double?,
  val overlaps: MutableList<String> = mutableListOf(),
  var impactDirection: String? = null,
)

const val POSSIBLE_IMPACT_TYPE = "possible_impact"

fun isPossibleImpact(event: DrivingEvent): Boolean = event.type == POSSIBLE_IMPACT_TYPE

fun impactDirectionLabel(direction: String?): String {
  return when (direction) {
    "front" -> "Front"
    "rear" -> "Rear"
    "rollover" -> "Rollover"
    else -> "Direction unknown"
  }
}

internal const val EVENT_HARSH_ACCEL = "harsh_accel"
internal const val EVENT_HARSH_BRAKE = "harsh_brake"
internal const val EVENT_HARSH_CORNER = "harsh_corner"
internal const val EVENT_SWERVE = "swerve"
internal const val EVENT_SPEEDING = "speeding"
internal const val EVENT_JERK = "jerk"

internal fun emptyEventCounts(): MutableMap<String, Int> {
  return mutableMapOf(
    EVENT_HARSH_ACCEL to 0,
    EVENT_HARSH_BRAKE to 0,
    EVENT_HARSH_CORNER to 0,
    EVENT_SWERVE to 0,
    EVENT_SPEEDING to 0,
    EVENT_JERK to 0,
    POSSIBLE_IMPACT_TYPE to 0,
    PHONE_HANDHELD_TYPE to 0,
  )
}
