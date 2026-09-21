package com.harshy.sdk

import kotlin.math.abs
import kotlin.math.max

data class AnalyzerPush(
  val metrics: LiveMetrics,
  val newEvents: List<DrivingEvent>,
)

class TripAnalyzer(
  configInput: DetectorConfig?,
  val sessionId: String,
  val startedAtMs: Double,
  val device: DeviceInfo,
  val trigger: String = "manual",
) {
  private var config: DetectorConfig = mergeDetectorConfig(configInput)
  private val location = mutableListOf<LocationSample>()
  private val imu = mutableListOf<ImuSample>()
  private val events = mutableListOf<DrivingEvent>()
  private val lastEventAt = mutableMapOf<String, Double>()
  private val lastEventLevel = mutableMapOf<String, String>()
  private var openSpeeding: DrivingEvent? = null
  private var openHandheld: DrivingEvent? = null
  private var handheld: HandheldFilter = emptyHandheldFilter()
  private var distanceM = 0.0
  private var lastGoodLocation: LocationSample? = null
  private var locationRejects = 0
  private var heading = HeadingFilter()
  private var lastImu: ImuSample? = null
  private var impactPulse: ImpactPulse? = null
  private var pendingImpact: PendingImpact? = null
  private var longitudinalAccelMps2: Double? = null
  private var lateralAccelMps2: Double? = null
  private var yawRateRadps: Double? = null
  private var maxSpeedMps: Double? = null
  private var speedSum = 0.0
  private var speedCount = 0

  fun setConfig(next: DetectorConfig) {
    config = mergeDetectorConfig(next)
  }

  fun getConfig(): DetectorConfig = config.copy(score = config.score.copy())

  fun getEvents(): List<DrivingEvent> = events.toList()

  fun getMetrics(): LiveMetrics {
    val t = lastGoodLocation?.t ?: lastImu?.t ?: startedAtMs
    return buildMetrics(t)
  }

  fun pushLocation(sample: LocationSample): AnalyzerPush {
    val decision = shouldAcceptDriveFix(location.lastOrNull(), sample, locationRejects)
    locationRejects = decision.rejects
    if (!decision.accept) {
      val t = lastGoodLocation?.t ?: lastImu?.t ?: startedAtMs
      return AnalyzerPush(metrics = buildMetrics(t), newEvents = emptyList())
    }

    val stored = sample.copy(
      speedMps = derivedSpeedMps(lastGoodLocation, sample) ?: sample.speedMps,
      courseDeg = derivedCourseDeg(lastGoodLocation, sample) ?: sample.courseDeg,
    )
    location.add(stored)
    if (locationUsable(stored, config)) {
      val previous = lastGoodLocation
      if (previous != null) {
        distanceM += haversineM(previous, stored)
      }
      lastGoodLocation = stored
      heading = advanceHeadingFilter(heading, stored, config.minSpeedMps)
      val speed = stored.speedMps
      if (speed != null) {
        speedSum += speed
        speedCount += 1
        maxSpeedMps = maxSpeedMps?.let { max(it, speed) } ?: speed
      }
    }

    val accel = gpsWindowAccel()
    longitudinalAccelMps2 = accel.longitudinal
    lateralAccelMps2 = accel.lateral
    yawRateRadps = accel.yawRateRadps
    val motion = detectFromMotion(stored.t)
    val impact = resolvePendingImpact(stored.t, force = false)
    val newEvents = if (impact != null) motion + impact else motion
    return AnalyzerPush(metrics = buildMetrics(stored.t), newEvents = newEvents)
  }

  fun pushImu(sample: ImuSample): AnalyzerPush {
    imu.add(sample)
    lastImu = sample
    val impact = ingestImpactImu(sample)
    val handheldEvents = ingestHandheldImu(sample)
    val motion = detectFromMotion(sample.t)
    return AnalyzerPush(metrics = buildMetrics(sample.t), newEvents = impact + handheldEvents + motion)
  }

  fun finalize(endedAtMs: Double = System.currentTimeMillis().toDouble()): SessionExport {
    flushImpact(endedAtMs)
    flushHandheld(endedAtMs)
    closeSpeedingSpan(endedAtMs)
    val road = assessRoad(
      location = location,
      imu = imu,
      startedAtMs = startedAtMs,
      jerkSettleMs = config.jerkSettleMs,
      minSpeedMps = config.minSpeedMps,
    )
    return SessionExport(
      schemaVersion = 1,
      sessionId = sessionId,
      startedAt = isoFromEpochMs(startedAtMs),
      endedAt = isoFromEpochMs(endedAtMs),
      config = config.copy(score = config.score.copy()),
      location = road,
      imu = imu.toList(),
      events = events.toList(),
      metrics = summarizeTrip(endedAtMs),
      device = device,
      trigger = trigger,
    )
  }

  private fun locationUsable(sample: LocationSample, config: DetectorConfig): Boolean {
    val accuracy = sample.accuracyM
    return accuracy == null || accuracy <= config.maxLocationAccuracyM
  }

  private fun lastEventOfType(type: String): DrivingEvent? {
    for (i in events.indices.reversed()) {
      val event = events[i]
      if (event.type == type) {
        return event
      }
    }
    return null
  }

  private fun maybeEmit(
    type: String,
    t: Double,
    peak: Double,
    threshold: Double,
    loc: LocationSample?,
    speedMps: Double?,
  ): DrivingEvent? {
    val level = harshEventLevel(peak, threshold, config.harshMediumX, config.harshHeavyX)
    val last = lastEventAt[type]
    if (last != null && t - last < config.cooldownMs) {
      val previous = lastEventLevel[type]
      if (previous != null && harshLevelRank(level) <= harshLevelRank(previous)) {
        return null
      }
      val existing = lastEventOfType(type)
      if (existing != null) {
        existing.peak = peak
        existing.severity = severityFromPeak(peak, threshold)
        existing.level = level
        existing.lat = loc?.lat ?: existing.lat
        existing.lon = loc?.lon ?: existing.lon
        existing.speedMps = speedMps
        lastEventAt[type] = t
        lastEventLevel[type] = level
        tagCompoundOverlaps(events, existing, t, config.compoundWindowMs)
        return existing
      }
    }

    val event = DrivingEvent(
      id = "$type-$t",
      type = type,
      t = t,
      endT = null,
      peak = peak,
      severity = severityFromPeak(peak, threshold),
      level = level,
      lat = loc?.lat,
      lon = loc?.lon,
      speedMps = speedMps,
    )
    events.add(event)
    lastEventAt[type] = t
    lastEventLevel[type] = level
    tagCompoundOverlaps(events, event, t, config.compoundWindowMs)
    return event
  }

  private data class GpsAccel(
    val longitudinal: Double?,
    val lateral: Double?,
    val yawRateRadps: Double?,
  )

  private fun gpsWindowAccel(): GpsAccel {
    val current = lastGoodLocation
    if (current == null || current.speedMps == null) {
      return GpsAccel(null, null, null)
    }

    var previous: LocationSample? = null
    for (i in location.size - 2 downTo 0) {
      val candidate = location[i]
      val dt = current.t - candidate.t
      if (dt >= config.gpsAccelWindowMs * 0.6 && locationUsable(candidate, config)) {
        previous = candidate
        break
      }
      if (dt > GPS_ACCEL_MAX_DT_SEC * 1000.0) {
        break
      }
    }

    val prev = previous
    val currentSpeed = current.speedMps
    val prevSpeed = prev?.speedMps
    if (prev == null || prevSpeed == null || currentSpeed == null) {
      return GpsAccel(null, null, null)
    }

    val dtSec = (current.t - prev.t) / 1000.0
    if (dtSec < GPS_ACCEL_MIN_DT_SEC || dtSec > GPS_ACCEL_MAX_DT_SEC) {
      return GpsAccel(null, null, null)
    }

    val longitudinal = (currentSpeed - prevSpeed) / dtSec
    var lateral: Double? = null
    var yaw: Double? = null
    val currentCourse = current.courseDeg
    val previousCourse = prev.courseDeg
    if (currentCourse != null && previousCourse != null) {
      val omega = toRad(unwrapDeltaDeg(previousCourse, currentCourse)) / dtSec
      val speed = (currentSpeed + prevSpeed) / 2.0
      lateral = speed * omega
      if (prevSpeed >= config.minSpeedMps && currentSpeed >= config.minSpeedMps) {
        yaw = abs(omega)
      }
    }
    return GpsAccel(longitudinal, lateral, yaw)
  }

  private fun currentSpeed(): Double? = lastGoodLocation?.speedMps

  private fun closeSpeedingSpan(t: Double): DrivingEvent? {
    val open = openSpeeding
    if (open == null || open.endT != null) {
      return null
    }
    open.endT = t
    openSpeeding = null
    tagCompoundOverlaps(events, open, t, config.compoundWindowMs)
    return open
  }

  private fun updateSpeedingSpan(
    t: Double,
    speed: Double?,
    loc: LocationSample?,
    moving: Boolean,
  ): DrivingEvent? {
    val cap = config.speedingMps ?: return closeSpeedingSpan(t)
    val over = moving && speed != null && speed >= cap
    if (over && speed != null) {
      val level = harshEventLevel(speed, cap, config.harshMediumX, config.harshHeavyX)
      val existingOpen = openSpeeding
      if (existingOpen == null) {
        val event = DrivingEvent(
          id = "speeding-$t",
          type = EVENT_SPEEDING,
          t = t,
          endT = null,
          peak = speed,
          severity = severityFromPeak(speed, cap),
          level = level,
          lat = loc?.lat,
          lon = loc?.lon,
          speedMps = speed,
        )
        events.add(event)
        openSpeeding = event
        tagCompoundOverlaps(events, event, t, config.compoundWindowMs)
        return event
      }
      if (speed > existingOpen.peak) {
        existingOpen.peak = speed
        existingOpen.severity = severityFromPeak(speed, cap)
        existingOpen.level = level
        existingOpen.lat = loc?.lat ?: existingOpen.lat
        existingOpen.lon = loc?.lon ?: existingOpen.lon
        existingOpen.speedMps = speed
        tagCompoundOverlaps(events, existingOpen, t, config.compoundWindowMs)
        return existingOpen
      }
      return null
    }
    val exit = cap * config.speedingExitX
    if (openSpeeding != null && (speed == null || speed < exit || !moving)) {
      return closeSpeedingSpan(t)
    }
    return null
  }

  private fun detectFromMotion(t: Double): List<DrivingEvent> {
    val emitted = mutableListOf<DrivingEvent>()
    val speed = currentSpeed()
    val moving = speed != null && speed >= config.minSpeedMps
    val loc = lastGoodLocation

    updateSpeedingSpan(t, speed, loc, moving)?.let { emitted.add(it) }

    val longAccel = longitudinalAccelMps2
    if (moving && longAccel != null) {
      if (longAccel >= config.harshAccelMps2) {
        maybeEmit(EVENT_HARSH_ACCEL, t, longAccel, config.harshAccelMps2, loc, speed)?.let {
          emitted.add(it)
        }
      } else if (longAccel <= -config.harshBrakeMps2) {
        maybeEmit(EVENT_HARSH_BRAKE, t, abs(longAccel), config.harshBrakeMps2, loc, speed)?.let {
          emitted.add(it)
        }
      }
    }

    val latAccel = lateralAccelMps2
    val cornering = moving && latAccel != null && abs(latAccel) >= config.harshCornerMps2
    if (cornering && latAccel != null) {
      maybeEmit(EVENT_HARSH_CORNER, t, abs(latAccel), config.harshCornerMps2, loc, speed)?.let {
        emitted.add(it)
      }
    }

    val yaw = yawRateRadps
    if (moving && !cornering && yaw != null && yaw >= config.harshSwerveRadps) {
      maybeEmit(EVENT_SWERVE, t, yaw, config.harshSwerveRadps, loc, speed)?.let { emitted.add(it) }
    }

    val accuracy = loc?.accuracyM
    val gpsWeak = loc == null || accuracy == null || accuracy > config.maxLocationAccuracyM
    val imuMag = lastImu?.linearAccel?.let { magnitude(it) }
      ?: lastImu?.let { magnitude(it.accel) }
    val jerkSettled = t - startedAtMs >= config.jerkSettleMs
    val lastImpact = lastEventAt[POSSIBLE_IMPACT_TYPE]
    val impactQuiet =
      impactPulse == null &&
        pendingImpact == null &&
        (lastImpact == null || t - lastImpact >= config.impactCooldownMs)
    if (
      jerkSettled &&
      impactQuiet &&
      gpsWeak &&
      imuMag != null &&
      imuMag >= config.harshBrakeMps2
    ) {
      maybeEmit(EVENT_JERK, t, imuMag, config.harshBrakeMps2, loc, speed)?.let { emitted.add(it) }
    }

    return emitted
  }

  private fun buildMetrics(t: Double): LiveMetrics {
    val durationMs = max(0.0, t - startedAtMs)
    val speedMps = currentSpeed()
    val moving = speedMps != null && speedMps >= config.minSpeedMps
    val levels = liveHarshLevels(moving, longitudinalAccelMps2, lateralAccelMps2, yawRateRadps, config)
    val last = lastImu
    return LiveMetrics(
      t = t,
      speedMps = speedMps,
      speedKmh = speedMps?.let { mpsToKmh(it) },
      headingDeg = heading.headingDeg,
      altitudeM = lastGoodLocation?.altitudeM,
      locationAccuracyM = lastGoodLocation?.accuracyM,
      longitudinalAccelMps2 = longitudinalAccelMps2,
      lateralAccelMps2 = lateralAccelMps2,
      verticalAccelMps2 = last?.linearAccel?.z ?: last?.accel?.z,
      accelMagnitudeMps2 = last?.let { magnitude(it.linearAccel ?: it.accel) },
      gyroMagnitudeRadps = last?.gyro?.let { magnitude(it) },
      accelLevel = levels.accelLevel,
      brakeLevel = levels.brakeLevel,
      cornerLevel = levels.cornerLevel,
      yawRateRadps = yawRateRadps,
      swerveLevel = levels.swerveLevel,
      distanceM = distanceM,
      durationMs = durationMs,
      score = scoreEvents(events, config, distanceM, durationMs),
    )
  }

  private fun emitPossibleImpact(
    pending: PendingImpact,
    direction: String,
    speedMps: Double?,
  ): DrivingEvent {
    val event = DrivingEvent(
      id = "possible_impact-${pending.t}",
      type = POSSIBLE_IMPACT_TYPE,
      t = pending.t,
      endT = null,
      peak = pending.peak,
      severity = severityFromPeak(pending.peak, config.impactPeakMps2),
      level = harshEventLevel(
        pending.peak,
        config.impactPeakMps2,
        config.harshMediumX,
        config.harshHeavyX,
      ),
      lat = pending.lat,
      lon = pending.lon,
      speedMps = speedMps,
      impactDirection = direction,
    )
    events.add(event)
    lastEventAt[POSSIBLE_IMPACT_TYPE] = pending.t
    lastEventLevel[POSSIBLE_IMPACT_TYPE] = event.level
    pendingImpact = null
    return event
  }

  private fun resolvePendingImpact(now: Double, force: Boolean): DrivingEvent? {
    val pending = pendingImpact ?: return null
    return when (
      val decision = decidePendingImpact(pending, location, now, force, config)
    ) {
      PendingImpactDecision.Wait -> null
      PendingImpactDecision.Discard -> {
        pendingImpact = null
        null
      }
      is PendingImpactDecision.Emit -> emitPossibleImpact(pending, decision.direction, decision.speedMps)
    }
  }

  private fun acceptClosedImpactPulse(pulse: ImpactPulse): DrivingEvent? {
    if (pendingImpact != null) {
      return null
    }
    return when (
      val decision = decideClosedPulse(
        pulse = pulse,
        imu = imu,
        location = location,
        lastLat = lastGoodLocation?.lat,
        lastLon = lastGoodLocation?.lon,
        startedAtMs = startedAtMs,
        lastImpactAt = lastEventAt[POSSIBLE_IMPACT_TYPE],
        config = config,
      )
    ) {
      ClosedPulseDecision.Reject -> null
      is ClosedPulseDecision.Pending -> {
        pendingImpact = decision.pending
        resolvePendingImpact(pulse.lastAboveT, force = false)
      }
    }
  }

  private fun ingestHandheldImu(sample: ImuSample): List<DrivingEvent> {
    val speed = currentSpeed()
    val moving = speed != null && speed >= config.minSpeedMps
    val stepped = advanceHandheld(
      filter = handheld,
      open = openHandheld,
      lastClosedAt = lastEventAt[PHONE_HANDHELD_TYPE],
      sample = sample,
      moving = moving,
      speedMps = speed,
      location = lastGoodLocation,
      startedAtMs = startedAtMs,
      config = config,
    )
    handheld = stepped.filter
    openHandheld = stepped.open
    val closedAt = stepped.lastClosedAt
    if (closedAt != null) {
      lastEventAt[PHONE_HANDHELD_TYPE] = closedAt
    }
    val emitted = stepped.emitted ?: return emptyList()
    if (emitted.endT == null && !events.contains(emitted)) {
      events.add(emitted)
      lastEventLevel[PHONE_HANDHELD_TYPE] = emitted.level
    } else if (emitted.endT == null) {
      lastEventLevel[PHONE_HANDHELD_TYPE] = emitted.level
    }
    return listOf(emitted)
  }

  private fun flushHandheld(endedAtMs: Double) {
    val closed = closeHandheldSpan(openHandheld, endedAtMs)
    if (closed != null) {
      lastEventAt[PHONE_HANDHELD_TYPE] = endedAtMs
    }
    openHandheld = null
  }

  private fun ingestImpactImu(sample: ImuSample): List<DrivingEvent> {
    val emitted = mutableListOf<DrivingEvent>()
    if (pendingImpact == null) {
      val stepped = advanceImpactPulse(impactPulse, sample, config.impactFloorMps2)
      impactPulse = stepped.pulse
      val closed = stepped.closed
      if (closed != null) {
        acceptClosedImpactPulse(closed)?.let { emitted.add(it) }
      }
    }
    resolvePendingImpact(sample.t, force = false)?.let { emitted.add(it) }
    return emitted
  }

  private fun flushImpact(endedAtMs: Double) {
    val pulse = impactPulse
    if (pulse != null) {
      acceptClosedImpactPulse(pulse)
      impactPulse = null
    }
    resolvePendingImpact(endedAtMs, force = true)
  }

  private fun summarizeTrip(endedAtMs: Double): TripMetrics {
    val durationMs = max(0.0, endedAtMs - startedAtMs)
    return TripMetrics(
      distanceM = distanceM,
      durationMs = durationMs,
      maxSpeedMps = maxSpeedMps,
      avgSpeedMps = if (speedCount == 0) null else speedSum / speedCount,
      score = scoreEvents(events, config, distanceM, durationMs),
      eventCounts = eventCounts(events),
    )
  }
}

fun createTripAnalyzer(
  config: DetectorConfig?,
  sessionId: String,
  startedAtMs: Double,
  device: DeviceInfo,
  trigger: String = "manual",
): TripAnalyzer {
  return TripAnalyzer(config, sessionId, startedAtMs, device, trigger)
}

fun scoreExposureScale(distanceM: Double, durationMs: Double, config: DetectorConfig): Double {
  val km = max(distanceM / 1000.0, config.score.minDistanceKm)
  val minutes = max(durationMs / 60_000.0, config.score.minDurationMin)
  val exposure =
    (km / config.score.refDistanceKm + minutes / config.score.refDurationMin) / 2.0
  return clamp(1 / max(exposure, 1e-6), 0.2, 4.0)
}

fun scoreEvents(
  events: List<DrivingEvent>,
  config: DetectorConfig,
  distanceM: Double,
  durationMs: Double,
): Double {
  var penalty = 0.0
  for (event in events) {
    penalty += eventWeight(event.type, config) * (0.4 + 0.6 * event.severity)
    if (event.overlaps.isNotEmpty()) {
      penalty += config.score.compound
    }
  }
  val scale = scoreExposureScale(distanceM, durationMs, config)
  return clamp(config.score.start - penalty * scale * SCORE_PENALTY_X, 0.0, 100.0)
}

fun eventCounts(events: List<DrivingEvent>): Map<String, Int> {
  val counts = emptyEventCounts()
  for (event in events) {
    counts[event.type] = (counts[event.type] ?: 0) + 1
  }
  return counts
}

fun analyzeTrip(
  location: List<LocationSample>,
  imu: List<ImuSample>,
  sessionId: String,
  startedAtMs: Double,
  endedAtMs: Double,
  device: DeviceInfo,
  config: DetectorConfig? = null,
  trigger: String = "manual",
): SessionExport {
  val analyzer = createTripAnalyzer(config, sessionId, startedAtMs, device, trigger)
  val locs = location.sortedBy { it.t }
  val imus = imu.sortedBy { it.t }
  var li = 0
  var ii = 0
  while (li < locs.size || ii < imus.size) {
    val loc = locs.getOrNull(li)
    val imuSample = imus.getOrNull(ii)
    val takeLocation = imuSample == null || (loc != null && loc.t <= imuSample.t)
    if (takeLocation && loc != null) {
      analyzer.pushLocation(loc)
      li += 1
    } else if (imuSample != null) {
      analyzer.pushImu(imuSample)
      ii += 1
    } else {
      break
    }
  }
  return analyzer.finalize(endedAtMs)
}

private fun eventWeight(type: String, config: DetectorConfig): Double {
  return when (type) {
    EVENT_HARSH_ACCEL -> config.score.harshAccel
    EVENT_HARSH_BRAKE -> config.score.harshBrake
    EVENT_HARSH_CORNER -> config.score.harshCorner
    EVENT_SWERVE -> config.score.swerve
    EVENT_SPEEDING -> config.score.speeding
    EVENT_JERK -> config.score.jerk
    POSSIBLE_IMPACT_TYPE -> 0.0
    PHONE_HANDHELD_TYPE -> 0.0
    else -> 0.0
  }
}
