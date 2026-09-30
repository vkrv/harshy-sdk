package com.harshy.sdk

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

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
  val capture: NativeStartOptions? = null,
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
  /** Latest GPS lateral came from path heading without chip/gyro confirm. */
  private var pathOnlyLateral = false
  private var harshCornerHold: SmoothHold? = null
  private var yawRateRadps: Double? = null
  private var prevYawRateRadps: Double? = null
  private var prevYawAtT: Double? = null
  private var yawJerkRadps2: Double? = null
  private var swerveElevatedSinceT: Double? = null
  private var swerveElevatedPeak = 0.0
  private var swerveElevatedRiseJerk = 0.0
  private var swerveElevatedAtSpeed: Double? = null
  private var maxSpeedMps: Double? = null
  private var speedSum = 0.0
  private var speedCount = 0
  private var heldSpeedLeap: LocationSample? = null
  private val smoothHold = mutableMapOf<String, SmoothHold>()
  private val smoothCreditAtM = mutableMapOf<String, Double>()
  private val spoiledKm = mutableSetOf<Int>()
  private var awardedKm = 0

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
    val carried = mutableListOf<DrivingEvent>()
    val pending = heldSpeedLeap
    if (pending != null) {
      heldSpeedLeap = null
      val prior = location.lastOrNull()
      if (prior == null || speedLeapHolds(prior, pending, sample)) {
        carried.addAll(commitLocation(pending).newEvents)
      }
    }

    val anchor = location.lastOrNull()
    val decision = shouldAcceptDriveFix(anchor, sample, locationRejects)
    locationRejects = decision.rejects
    if (!decision.accept) {
      val t = lastGoodLocation?.t ?: lastImu?.t ?: startedAtMs
      return AnalyzerPush(metrics = buildMetrics(t), newEvents = carried)
    }
    if (anchor != null && isSuspiciousSpeedLeap(anchor, sample)) {
      heldSpeedLeap = sample
      val t = lastGoodLocation?.t ?: lastImu?.t ?: startedAtMs
      return AnalyzerPush(metrics = buildMetrics(t), newEvents = carried)
    }
    val committed = commitLocation(sample)
    return AnalyzerPush(
      metrics = committed.metrics,
      newEvents = carried + committed.newEvents,
    )
  }

  private fun commitLocation(sample: LocationSample): AnalyzerPush {
    // Keep the OS chip course as-is. Filling from the path made every yaw look
    // chip-confirmed and defeated path-only GPS noise gates.
    val stored = sample.copy(
      speedMps = derivedSpeedMps(lastGoodLocation, sample) ?: sample.speedMps,
      courseDeg = sample.courseDeg,
    )
    location.add(stored)
    if (locationUsable(stored, config)) {
      val previous = lastGoodLocation
      if (previous != null) {
        distanceM += haversineM(previous, stored)
      }
      lastGoodLocation = stored
      heading = advanceHeadingFilter(
        heading,
        stored.copy(courseDeg = derivedCourseDeg(previous, sample)),
        config.minSpeedMps,
      )
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
    pathOnlyLateral = accel.pathOnlyLateral
    yawRateRadps = accel.yawRateRadps
    val yaw = accel.yawRateRadps
    yawJerkRadps2 =
      if (yaw == null) null else yawRateJerkRadps2(yaw, stored.t, prevYawRateRadps, prevYawAtT)
    val motion = detectFromMotion(stored.t, includeSmooth = true)
    val impact = resolvePendingImpact(stored.t, force = false)
    if (yaw == null) {
      prevYawRateRadps = null
      prevYawAtT = null
    } else {
      prevYawRateRadps = yaw
      prevYawAtT = stored.t
    }
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
      capture = capture,
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
        noteHarshKilometre(type)
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
    noteHarshKilometre(type)
    return event
  }

  private fun noteHarshKilometre(type: String) {
    if (
      type != EVENT_HARSH_ACCEL &&
      type != EVENT_HARSH_BRAKE &&
      type != EVENT_HARSH_CORNER &&
      type != EVENT_SWERVE &&
      type != EVENT_JERK
    ) {
      return
    }
    spoiledKm.add(kotlin.math.floor(distanceM / 1000.0).toInt())
  }

  private data class GpsAccel(
    val longitudinal: Double?,
    val lateral: Double?,
    val yawRateRadps: Double?,
    val pathOnlyLateral: Boolean,
  )

  private fun gpsWindowAccel(): GpsAccel {
    val current = lastGoodLocation
    if (current == null || current.speedMps == null) {
      return GpsAccel(null, null, null, false)
    }

    var previous: LocationSample? = null
    var previousIndex = -1
    for (i in location.size - 2 downTo 0) {
      val candidate = location[i]
      val dt = current.t - candidate.t
      if (dt >= config.gpsAccelWindowMs * 0.6 && locationUsable(candidate, config)) {
        previous = candidate
        previousIndex = i
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
      return GpsAccel(null, null, null, false)
    }

    val dtSec = (current.t - prev.t) / 1000.0
    if (dtSec < GPS_ACCEL_MIN_DT_SEC || dtSec > GPS_ACCEL_MAX_DT_SEC) {
      return GpsAccel(null, null, null, false)
    }

    val longitudinal = (currentSpeed - prevSpeed) / dtSec
    val before = if (previousIndex > 0) location[previousIndex - 1] else null
    val pathMinM = pathBearingMinM(prev.accuracyM, current.accuracyM)
    val yaw = confirmedYawDetail(
      dtSec = dtSec,
      chipFromDeg = prev.courseDeg,
      chipToDeg = current.courseDeg,
      pathFromDeg = pathBearingDeg(before, prev, pathMinM),
      pathToDeg = pathBearingDeg(prev, current, pathMinM),
      verticalGyroRadps = meanVerticalGyro(prev.t, current.t),
      phoneHandheld = openHandheld != null,
    )
    var lateral: Double? = null
    var yawRate: Double? = null
    var pathOnlyLateral = false
    val speedsOk = prevSpeed >= config.minSpeedMps && currentSpeed >= config.minSpeedMps
    val omega = yaw.omega
    if (omega != null) {
      val speed = (currentSpeed + prevSpeed) / 2.0
      val nextLateral = speed * omega
      if (yaw.pathOnly) {
        pathOnlyLateral = true
        val hasAcc = prev.accuracyM != null || current.accuracyM != null
        val worstAcc = maxOf(prev.accuracyM ?: 0.0, current.accuracyM ?: 0.0)
        lateral = when {
          hasAcc && worstAcc > PATH_ONLY_CORNER_MAX_ACCURACY_M -> null
          abs(nextLateral) > PATH_ONLY_LATERAL_MAX_MPS2 -> null
          else -> nextLateral
        }
      } else {
        lateral = nextLateral
      }
      if (speedsOk) {
        yawRate = abs(omega)
      }
    } else if (speedsOk) {
      yawRate = 0.0
    }
    return GpsAccel(longitudinal, lateral, yawRate, pathOnlyLateral)
  }

  private fun meanVerticalGyro(fromT: Double, toT: Double): Double? {
    var sum = 0.0
    var count = 0
    for (i in imu.indices.reversed()) {
      val sample = imu[i]
      if (sample.t > toT) {
        continue
      }
      if (sample.t < fromT) {
        break
      }
      val yaw = verticalGyroRadps(sample.gyro, sample.gravity) ?: continue
      sum += yaw
      count += 1
    }
    return if (count == 0) null else sum / count
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

  private fun detectFromMotion(t: Double, includeSmooth: Boolean = false): List<DrivingEvent> {
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
      val event = if (pathOnlyLateral) {
        resolvePathOnlyHarshCorner(t, loc, speed)
      } else {
        maybeEmit(EVENT_HARSH_CORNER, t, abs(latAccel), config.harshCornerMps2, loc, speed)
      }
      if (!pathOnlyLateral) {
        harshCornerHold = null
      }
      if (event != null) {
        emitted.add(event)
      }
    } else {
      harshCornerHold = null
    }

    val yaw = yawRateRadps
    resolveSwervePeak(t, speed, cornering, yaw)?.let { peak ->
      maybeEmit(EVENT_SWERVE, t, peak, config.harshSwerveRadps, loc, speed)?.let { emitted.add(it) }
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

    if (includeSmooth) {
      emitted.addAll(updateSmoothCredits(t, moving, loc, speed))
      emitted.addAll(awardCleanKilometres(t, loc, speed))
    }

    return emitted
  }

  private fun resolveSwervePeak(
    t: Double,
    speed: Double?,
    cornering: Boolean,
    yaw: Double?,
  ): Double? {
    val thr = config.harshSwerveRadps
    val exitThr = thr * 0.5
    if (yaw == null) {
      swerveElevatedSinceT = null
      swerveElevatedPeak = 0.0
      swerveElevatedRiseJerk = 0.0
      swerveElevatedAtSpeed = null
      return null
    }
    if (yaw >= thr) {
      if (swerveElevatedSinceT == null) {
        swerveElevatedSinceT = t
        swerveElevatedPeak = yaw
        swerveElevatedRiseJerk = yawJerkRadps2 ?: 0.0
        swerveElevatedAtSpeed = speed
      } else {
        if (yaw > swerveElevatedPeak) {
          swerveElevatedPeak = yaw
        }
        val jerk = yawJerkRadps2
        if (jerk != null && jerk > swerveElevatedRiseJerk) {
          swerveElevatedRiseJerk = jerk
        }
        if (speed != null) {
          swerveElevatedAtSpeed = swerveElevatedAtSpeed?.let { max(it, speed) } ?: speed
        }
      }
      return null
    }
    val since = swerveElevatedSinceT ?: return null
    val elevatedMs = t - since
    val peak = swerveElevatedPeak
    val riseJerk = swerveElevatedRiseJerk
    val peakSpeed = swerveElevatedAtSpeed
    swerveElevatedSinceT = null
    swerveElevatedPeak = 0.0
    swerveElevatedRiseJerk = 0.0
    swerveElevatedAtSpeed = null
    if (yaw > exitThr) {
      return null
    }
    return if (
      isSwerveMotion(peakSpeed ?: speed, cornering, peak, riseJerk, elevatedMs, config)
    ) {
      peak
    } else {
      null
    }
  }

  private fun awardCleanKilometres(t: Double, loc: LocationSample?, speed: Double?): List<DrivingEvent> {
    val emitted = mutableListOf<DrivingEvent>()
    while (distanceM >= (awardedKm + 1) * 1000.0) {
      val index = awardedKm
      awardedKm += 1
      if (spoiledKm.contains(index)) {
        continue
      }
      val kmNumber = index + 1
      val points = if (kmNumber <= 10) 3.0 else 2.0
      val event = DrivingEvent(
        id = "smooth_km-$kmNumber",
        type = EVENT_SMOOTH_KM,
        t = t,
        peak = points,
        severity = 0.0,
        level = "light",
        lat = loc?.lat,
        lon = loc?.lon,
        speedMps = speed,
      )
      events.add(event)
      emitted.add(event)
    }
    return emitted
  }

  private data class SmoothHold(
    var sinceT: Double,
    var sinceDistanceM: Double,
    var peak: Double,
    var sign: Int? = null,
    var headingAtStartDeg: Double? = null,
  )

  /**
   * Path-only harsh corners need same-sign lateral held with a real heading change.
   * Zig-zag GPS at the start of a trip flips sign and never commits.
   */
  private fun resolvePathOnlyHarshCorner(
    t: Double,
    loc: LocationSample?,
    speed: Double?,
  ): DrivingEvent? {
    val lateral = lateralAccelMps2
    if (lateral == null || lateral == 0.0) {
      harshCornerHold = null
      return null
    }
    val sign = if (lateral > 0) 1 else -1
    val magnitude = abs(lateral)
    val heading = latestPathHeadingDeg()
    if (heading == null) {
      harshCornerHold = null
      return null
    }
    val hold = harshCornerHold
    if (hold == null || hold.sign != sign) {
      harshCornerHold = SmoothHold(t, distanceM, magnitude, sign, heading)
      return null
    }
    hold.peak = max(hold.peak, magnitude)
    val heldMs = t - hold.sinceT
    val movedM = distanceM - hold.sinceDistanceM
    if (heldMs < HARSH_CORNER_HOLD_MS || movedM < HARSH_CORNER_HOLD_MIN_M) {
      return null
    }
    val startHeading = hold.headingAtStartDeg
    if (startHeading == null || abs(unwrapDeltaDeg(startHeading, heading)) < HARSH_CORNER_MIN_TURN_DEG) {
      return null
    }
    harshCornerHold = null
    return maybeEmit(EVENT_HARSH_CORNER, t, hold.peak, config.harshCornerMps2, loc, speed)
  }

  private fun latestPathHeadingDeg(): Double? {
    val current = lastGoodLocation ?: return null
    for (i in location.size - 2 downTo 0) {
      val previous = location[i]
      val bearing = pathBearingDeg(previous, current)
      if (bearing != null) {
        return bearing
      }
      if (current.t - previous.t > GPS_ACCEL_MAX_DT_SEC * 1000) {
        break
      }
    }
    return null
  }

  private fun smoothMagnitude(type: String, longitudinal: Double?, lateral: Double?): Double? {
    val magnitude: Double
    val harsh: Double
    when (type) {
      EVENT_SMOOTH_ACCEL -> {
        if (longitudinal == null || longitudinal <= 0.0) return null
        magnitude = longitudinal
        harsh = config.harshAccelMps2
      }
      EVENT_SMOOTH_BRAKE -> {
        if (longitudinal == null || longitudinal >= 0.0) return null
        magnitude = -longitudinal
        harsh = config.harshBrakeMps2
      }
      else -> {
        if (lateral == null) return null
        magnitude = abs(lateral)
        harsh = config.harshCornerMps2
      }
    }
    val ceiling = harsh * SMOOTH_CEILING_X
    if (ceiling < SMOOTH_FLOOR_MPS2 || magnitude < SMOOTH_FLOOR_MPS2 || magnitude > ceiling) {
      return null
    }
    return magnitude
  }

  private fun updateSmoothCredits(
    t: Double,
    moving: Boolean,
    loc: LocationSample?,
    speed: Double?,
  ): List<DrivingEvent> {
    val emitted = mutableListOf<DrivingEvent>()
    for (type in listOf(EVENT_SMOOTH_ACCEL, EVENT_SMOOTH_BRAKE, EVENT_SMOOTH_CORNER)) {
      val magnitude = if (moving) smoothMagnitude(type, longitudinalAccelMps2, lateralAccelMps2) else null
      if (magnitude == null) {
        smoothHold.remove(type)
        continue
      }
      if (type == EVENT_SMOOTH_CORNER) {
        val lateral = lateralAccelMps2
        if (lateral == null || lateral == 0.0) {
          smoothHold.remove(type)
          continue
        }
        val sign = if (lateral > 0) 1 else -1
        val heading = latestPathHeadingDeg()
        if (heading == null) {
          smoothHold.remove(type)
          continue
        }
        val hold = smoothHold[type]
        if (hold == null || hold.sign != sign) {
          smoothHold[type] = SmoothHold(t, distanceM, magnitude, sign, heading)
          continue
        }
        hold.peak = max(hold.peak, magnitude)
        val heldMs = t - hold.sinceT
        val movedM = distanceM - hold.sinceDistanceM
        if (heldMs < SMOOTH_HOLD_MS || movedM < SMOOTH_HOLD_MIN_M) {
          continue
        }
        val startHeading = hold.headingAtStartDeg
        if (startHeading == null || abs(unwrapDeltaDeg(startHeading, heading)) < SMOOTH_CORNER_MIN_TURN_DEG) {
          continue
        }
        val lastCreditM = smoothCreditAtM[type]
        if (lastCreditM != null && distanceM - lastCreditM < SMOOTH_GAP_M) {
          continue
        }
        val event = DrivingEvent(
          id = "$type-$t",
          type = type,
          t = t,
          peak = hold.peak,
          severity = 0.0,
          level = "light",
          lat = loc?.lat,
          lon = loc?.lon,
          speedMps = speed,
        )
        events.add(event)
        smoothCreditAtM[type] = distanceM
        smoothHold.remove(type)
        emitted.add(event)
        continue
      }
      val hold = smoothHold[type]
      if (hold == null) {
        smoothHold[type] = SmoothHold(t, distanceM, magnitude)
        continue
      }
      hold.peak = max(hold.peak, magnitude)
      val heldMs = t - hold.sinceT
      val movedM = distanceM - hold.sinceDistanceM
      if (heldMs < SMOOTH_HOLD_MS || movedM < SMOOTH_HOLD_MIN_M) {
        continue
      }
      val lastCreditM = smoothCreditAtM[type]
      if (lastCreditM != null && distanceM - lastCreditM < SMOOTH_GAP_M) {
        continue
      }
      val event = DrivingEvent(
        id = "$type-$t",
        type = type,
        t = t,
        peak = hold.peak,
        severity = 0.0,
        level = "light",
        lat = loc?.lat,
        lon = loc?.lon,
        speedMps = speed,
      )
      events.add(event)
      smoothCreditAtM[type] = distanceM
      smoothHold.remove(type)
      emitted.add(event)
    }
    return emitted
  }

  private fun buildMetrics(t: Double): LiveMetrics {
    val durationMs = max(0.0, t - startedAtMs)
    val speedMps = currentSpeed()
    val moving = speedMps != null && speedMps >= config.minSpeedMps
    val latAccel = lateralAccelMps2
    val cornering = moving && latAccel != null && abs(latAccel) >= config.harshCornerMps2
    val elevatedMs = swerveElevatedSinceT?.let { t - it }
    val liveSwerve =
      swerveElevatedSinceT != null &&
        elevatedMs != null &&
        elevatedMs <= config.swerveMaxElevatedMs &&
        isSwerveMotion(
          swerveElevatedAtSpeed ?: speedMps,
          cornering,
          swerveElevatedPeak,
          swerveElevatedRiseJerk,
          maxOf(elevatedMs, 1.0),
          config,
        )
    val swerveYaw = if (liveSwerve) swerveElevatedPeak else null
    val levels = liveHarshLevels(moving, longitudinalAccelMps2, lateralAccelMps2, swerveYaw, config)
    val last = lastImu
    val points = scoreEvents(events, config, distanceM, durationMs)
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
      points = points,
      score = relativeScore(points, distanceM, config.score.refDistanceKm, config.score.minDistanceKm),
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
    val points = scoreEvents(events, config, distanceM, durationMs)
    return TripMetrics(
      distanceM = distanceM,
      durationMs = durationMs,
      maxSpeedMps = maxSpeedMps,
      avgSpeedMps = if (speedCount == 0) null else speedSum / speedCount,
      points = points,
      score = relativeScore(points, distanceM, config.score.refDistanceKm, config.score.minDistanceKm),
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
  capture: NativeStartOptions? = null,
): TripAnalyzer {
  return TripAnalyzer(config, sessionId, startedAtMs, device, trigger, capture)
}

@Suppress("UNUSED_PARAMETER")
fun scoreExposureScale(distanceM: Double, durationMs: Double, config: DetectorConfig): Double {
  val km = max(distanceM / 1000.0, config.score.minDistanceKm)
  val exposure = km / config.score.refDistanceKm
  return clamp(1 / max(exposure, 1e-6), SCORE_EXPOSURE_MIN, SCORE_EXPOSURE_MAX)
}

fun eventScorePoints(event: DrivingEvent, config: DetectorConfig, distanceM: Double): Double {
  return when (event.type) {
    EVENT_SMOOTH_KM -> if (event.peak >= 2.5) 3.0 else 2.0
    EVENT_SMOOTH_ACCEL, EVENT_SMOOTH_BRAKE, EVENT_SMOOTH_CORNER -> 2.0
    EVENT_HARSH_ACCEL -> harshBandPoints(event.level, -5.0, -8.0, -12.0)
    EVENT_HARSH_BRAKE -> harshBandPoints(event.level, -8.0, -12.0, -16.0)
    EVENT_HARSH_CORNER -> harshBandPoints(event.level, -4.0, -8.0, -12.0)
    EVENT_SWERVE -> harshBandPoints(event.level, -4.0, -7.0, -10.0)
    EVENT_JERK -> harshBandPoints(event.level, -3.0, -5.0, -6.0)
    else -> 0.0
  }
}

private fun harshBandPoints(level: String, light: Double, medium: Double, heavy: Double): Double {
  return when (level) {
    "heavy" -> heavy
    "medium" -> medium
    else -> light
  }
}

@Suppress("UNUSED_PARAMETER")
fun scoreEvents(
  events: List<DrivingEvent>,
  config: DetectorConfig,
  distanceM: Double,
  durationMs: Double,
): Double {
  var sum = 0.0
  for (event in events) {
    sum += eventScorePoints(event, config, distanceM)
  }
  return min(sum, SCORE_MAX)
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
  capture: NativeStartOptions? = null,
): SessionExport {
  val analyzer = createTripAnalyzer(config, sessionId, startedAtMs, device, trigger, capture)
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
    EVENT_SMOOTH_ACCEL -> config.score.smoothAccel
    EVENT_SMOOTH_BRAKE -> config.score.smoothBrake
    EVENT_SMOOTH_CORNER -> config.score.smoothCorner
    else -> 0.0
  }
}
