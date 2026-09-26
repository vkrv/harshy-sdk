import Foundation

public struct HarshyAnalyzerPush {
  public var metrics: HarshyLiveMetrics
  public var newEvents: [HarshyDrivingEvent]
}

public final class HarshyTripAnalyzer {
  public let sessionId: String
  public let startedAtMs: Double
  public let device: HarshyDeviceInfo
  public let trigger: String

  private var config: HarshyDetectorConfig
  private var location: [HarshyLocationSample] = []
  private var imu: [HarshyImuSample] = []
  private var events: [HarshyDrivingEvent] = []
  private var lastEventAt: [String: Double] = [:]
  private var lastEventLevel: [String: String] = [:]
  private var openSpeeding: HarshyDrivingEvent?
  private var openHandheld: HarshyDrivingEvent?
  private var handheld = harshyEmptyHandheldFilter()
  private var distanceM = 0.0
  private var lastGoodLocation: HarshyLocationSample?
  private var locationRejects = 0
  private var heading = harshyEmptyHeadingFilter()
  private var lastImu: HarshyImuSample?
  private var impactPulse: HarshyImpactPulse?
  private var pendingImpact: HarshyPendingImpact?
  private var longitudinalAccelMps2: Double?
  private var lateralAccelMps2: Double?
  private var yawRateRadps: Double?
  private var maxSpeedMps: Double?
  private var speedSum = 0.0
  private var speedCount = 0
  private var heldSpeedLeap: HarshyLocationSample?

  public init(
    config: HarshyDetectorConfig?,
    sessionId: String,
    startedAtMs: Double,
    device: HarshyDeviceInfo,
    trigger: String = "manual"
  ) {
    self.config = harshyMergeDetectorConfig(config)
    self.sessionId = sessionId
    self.startedAtMs = startedAtMs
    self.device = device
    self.trigger = harshyParseTripTrigger(trigger)
  }

  public func setConfig(_ next: HarshyDetectorConfig) {
    config = harshyMergeDetectorConfig(next)
  }

  public func getConfig() -> HarshyDetectorConfig { config }

  public func getEvents() -> [HarshyDrivingEvent] { events }

  public func getMetrics() -> HarshyLiveMetrics {
    let t = lastGoodLocation?.t ?? lastImu?.t ?? startedAtMs
    return buildMetrics(t)
  }

  @discardableResult
  public func pushLocation(_ sample: HarshyLocationSample) -> HarshyAnalyzerPush {
    var carried: [HarshyDrivingEvent] = []
    if let pending = heldSpeedLeap {
      heldSpeedLeap = nil
      let prior = location.last
      if prior == nil || harshySpeedLeapHolds(anchor: prior!, leap: pending, next: sample) {
        carried.append(contentsOf: commitLocation(pending).newEvents)
      }
    }

    let anchor = location.last
    let decision = harshyShouldAcceptDriveFix(
      anchor: anchor,
      sample: sample,
      consecutiveRejects: locationRejects
    )
    locationRejects = decision.rejects
    if !decision.accept {
      let t = lastGoodLocation?.t ?? lastImu?.t ?? startedAtMs
      return HarshyAnalyzerPush(metrics: buildMetrics(t), newEvents: carried)
    }
    if let anchor, harshyIsSuspiciousSpeedLeap(anchor, sample) {
      heldSpeedLeap = sample
      let t = lastGoodLocation?.t ?? lastImu?.t ?? startedAtMs
      return HarshyAnalyzerPush(metrics: buildMetrics(t), newEvents: carried)
    }
    let committed = commitLocation(sample)
    return HarshyAnalyzerPush(metrics: committed.metrics, newEvents: carried + committed.newEvents)
  }

  private func commitLocation(_ sample: HarshyLocationSample) -> HarshyAnalyzerPush {
    var stored = sample
    stored.speedMps = harshyDerivedSpeedMps(from: lastGoodLocation, to: sample) ?? stored.speedMps
    stored.courseDeg = harshyDerivedCourseDeg(from: lastGoodLocation, to: sample) ?? stored.courseDeg
    location.append(stored)
    if locationUsable(stored) {
      if let previous = lastGoodLocation {
        distanceM += harshyHaversineM(previous, stored)
      }
      lastGoodLocation = stored
      heading = harshyAdvanceHeadingFilter(heading, sample: stored, minSpeedMps: config.minSpeedMps)
      if let speed = stored.speedMps {
        speedSum += speed
        speedCount += 1
        maxSpeedMps = max(maxSpeedMps ?? speed, speed)
      }
    }
    let accel = gpsWindowAccel()
    longitudinalAccelMps2 = accel.longitudinal
    lateralAccelMps2 = accel.lateral
    yawRateRadps = accel.yawRateRadps
    let motion = detectFromMotion(stored.t)
    let impact = resolvePendingImpact(now: stored.t, force: false)
    let newEvents = impact.map { motion + [$0] } ?? motion
    return HarshyAnalyzerPush(metrics: buildMetrics(stored.t), newEvents: newEvents)
  }

  @discardableResult
  public func pushImu(_ sample: HarshyImuSample) -> HarshyAnalyzerPush {
    imu.append(sample)
    lastImu = sample
    let impact = ingestImpactImu(sample)
    let handheldEvents = ingestHandheldImu(sample)
    let motion = detectFromMotion(sample.t)
    return HarshyAnalyzerPush(metrics: buildMetrics(sample.t), newEvents: impact + handheldEvents + motion)
  }

  public func finalize(endedAtMs: Double = Date().timeIntervalSince1970 * 1000) -> HarshySessionExport {
    flushImpact(endedAtMs)
    flushHandheld(endedAtMs)
    _ = closeSpeedingSpan(endedAtMs)
    let road = harshyAssessRoad(
      location: location,
      imu: imu,
      startedAtMs: startedAtMs,
      jerkSettleMs: config.jerkSettleMs,
      minSpeedMps: config.minSpeedMps
    )
    return HarshySessionExport(
      schemaVersion: 1,
      sessionId: sessionId,
      startedAt: harshyIsoFromEpochMs(startedAtMs),
      endedAt: harshyIsoFromEpochMs(endedAtMs),
      config: config,
      location: road,
      imu: imu,
      events: events,
      metrics: summarizeTrip(endedAtMs),
      device: device,
      trigger: trigger
    )
  }

  private func locationUsable(_ sample: HarshyLocationSample) -> Bool {
    sample.accuracyM == nil || sample.accuracyM! <= config.maxLocationAccuracyM
  }

  private func lastEventOfType(_ type: String) -> HarshyDrivingEvent? {
    events.last { $0.type == type }
  }

  private func maybeEmit(
    type: String,
    t: Double,
    peak: Double,
    threshold: Double,
    location loc: HarshyLocationSample?,
    speedMps: Double?
  ) -> HarshyDrivingEvent? {
    let level = harshyEventLevel(peak: peak, threshold: threshold, mediumX: config.harshMediumX, heavyX: config.harshHeavyX)
    if let last = lastEventAt[type], t - last < config.cooldownMs {
      if let previous = lastEventLevel[type], harshyLevelRank(level) <= harshyLevelRank(previous) {
        return nil
      }
      if let existing = lastEventOfType(type) {
        existing.peak = peak
        existing.severity = harshySeverityFromPeak(peak: peak, threshold: threshold)
        existing.level = level
        existing.lat = loc?.lat ?? existing.lat
        existing.lon = loc?.lon ?? existing.lon
        existing.speedMps = speedMps
        lastEventAt[type] = t
        lastEventLevel[type] = level
        harshyTagCompoundOverlaps(events: events, incoming: existing, now: t, windowMs: config.compoundWindowMs)
        return existing
      }
    }
    let event = HarshyDrivingEvent(
      id: "\(type)-\(t)",
      type: type,
      t: t,
      peak: peak,
      severity: harshySeverityFromPeak(peak: peak, threshold: threshold),
      level: level,
      lat: loc?.lat,
      lon: loc?.lon,
      speedMps: speedMps
    )
    events.append(event)
    lastEventAt[type] = t
    lastEventLevel[type] = level
    harshyTagCompoundOverlaps(events: events, incoming: event, now: t, windowMs: config.compoundWindowMs)
    return event
  }

  private func gpsWindowAccel() -> (longitudinal: Double?, lateral: Double?, yawRateRadps: Double?) {
    guard let current = lastGoodLocation, current.speedMps != nil else {
      return (nil, nil, nil)
    }
    var previous: HarshyLocationSample?
    if location.count >= 2 {
      for i in stride(from: location.count - 2, through: 0, by: -1) {
        let candidate = location[i]
        let dt = current.t - candidate.t
        if dt >= config.gpsAccelWindowMs * 0.6 && locationUsable(candidate) {
          previous = candidate
          break
        }
        if dt > harshyGpsAccelMaxDtSec * 1000 { break }
      }
    }
    guard let previous, let prevSpeed = previous.speedMps, let currentSpeed = current.speedMps else {
      return (nil, nil, nil)
    }
    let dtSec = (current.t - previous.t) / 1000
    if dtSec < harshyGpsAccelMinDtSec || dtSec > harshyGpsAccelMaxDtSec {
      return (nil, nil, nil)
    }
    let longitudinal = (currentSpeed - prevSpeed) / dtSec
    var lateral: Double?
    var yaw: Double?
    if let currentCourse = current.courseDeg, let previousCourse = previous.courseDeg {
      let omega = harshyToRad(harshyUnwrapDeltaDeg(fromDeg: previousCourse, toDeg: currentCourse)) / dtSec
      let speed = (currentSpeed + prevSpeed) / 2
      lateral = speed * omega
      if prevSpeed >= config.minSpeedMps && currentSpeed >= config.minSpeedMps {
        yaw = abs(omega)
      }
    }
    return (longitudinal, lateral, yaw)
  }

  private func currentSpeed() -> Double? { lastGoodLocation?.speedMps }

  @discardableResult
  private func closeSpeedingSpan(_ t: Double) -> HarshyDrivingEvent? {
    guard let open = openSpeeding, open.endT == nil else { return nil }
    open.endT = t
    openSpeeding = nil
    harshyTagCompoundOverlaps(events: events, incoming: open, now: t, windowMs: config.compoundWindowMs)
    return open
  }

  private func updateSpeedingSpan(
    t: Double,
    speed: Double?,
    loc: HarshyLocationSample?,
    moving: Bool
  ) -> HarshyDrivingEvent? {
    guard let cap = config.speedingMps else {
      return closeSpeedingSpan(t)
    }
    let over = moving && speed != nil && speed! >= cap
    if over, let speed {
      let level = harshyEventLevel(peak: speed, threshold: cap, mediumX: config.harshMediumX, heavyX: config.harshHeavyX)
      if openSpeeding == nil {
        let event = HarshyDrivingEvent(
          id: "speeding-\(t)",
          type: harshyEventSpeeding,
          t: t,
          peak: speed,
          severity: harshySeverityFromPeak(peak: speed, threshold: cap),
          level: level,
          lat: loc?.lat,
          lon: loc?.lon,
          speedMps: speed
        )
        events.append(event)
        openSpeeding = event
        harshyTagCompoundOverlaps(events: events, incoming: event, now: t, windowMs: config.compoundWindowMs)
        return event
      }
      if let open = openSpeeding, speed > open.peak {
        open.peak = speed
        open.severity = harshySeverityFromPeak(peak: speed, threshold: cap)
        open.level = level
        open.lat = loc?.lat ?? open.lat
        open.lon = loc?.lon ?? open.lon
        open.speedMps = speed
        harshyTagCompoundOverlaps(events: events, incoming: open, now: t, windowMs: config.compoundWindowMs)
        return open
      }
      return nil
    }
    let exit = cap * config.speedingExitX
    if openSpeeding != nil && (speed == nil || speed! < exit || !moving) {
      return closeSpeedingSpan(t)
    }
    return nil
  }

  private func detectFromMotion(_ t: Double) -> [HarshyDrivingEvent] {
    var emitted: [HarshyDrivingEvent] = []
    let speed = currentSpeed()
    let moving = speed != nil && speed! >= config.minSpeedMps
    let loc = lastGoodLocation
    if let speeding = updateSpeedingSpan(t: t, speed: speed, loc: loc, moving: moving) {
      emitted.append(speeding)
    }
    if moving, let longAccel = longitudinalAccelMps2 {
      if longAccel >= config.harshAccelMps2 {
        if let event = maybeEmit(
          type: harshyEventHarshAccel,
          t: t,
          peak: longAccel,
          threshold: config.harshAccelMps2,
          location: loc,
          speedMps: speed
        ) {
          emitted.append(event)
        }
      } else if longAccel <= -config.harshBrakeMps2 {
        if let event = maybeEmit(
          type: harshyEventHarshBrake,
          t: t,
          peak: abs(longAccel),
          threshold: config.harshBrakeMps2,
          location: loc,
          speedMps: speed
        ) {
          emitted.append(event)
        }
      }
    }
    let latAccel = lateralAccelMps2
    let cornering = moving && latAccel != nil && abs(latAccel!) >= config.harshCornerMps2
    if cornering, let latAccel {
      if let event = maybeEmit(
        type: harshyEventHarshCorner,
        t: t,
        peak: abs(latAccel),
        threshold: config.harshCornerMps2,
        location: loc,
        speedMps: speed
      ) {
        emitted.append(event)
      }
    }
    let yaw = yawRateRadps
    if moving && !cornering, let yaw, yaw >= config.harshSwerveRadps {
      if let event = maybeEmit(
        type: harshyEventSwerve,
        t: t,
        peak: yaw,
        threshold: config.harshSwerveRadps,
        location: loc,
        speedMps: speed
      ) {
        emitted.append(event)
      }
    }
    let gpsWeak =
      loc == nil || loc?.accuracyM == nil || (loc?.accuracyM ?? 0) > config.maxLocationAccuracyM
    let imuMag = lastImu?.linearAccel.map(harshyMagnitude) ?? lastImu.map { harshyMagnitude($0.accel) }
    let jerkSettled = t - startedAtMs >= config.jerkSettleMs
    let lastImpact = lastEventAt[harshyPossibleImpactType]
    let impactQuiet =
      impactPulse == nil &&
      pendingImpact == nil &&
      (lastImpact == nil || t - lastImpact! >= config.impactCooldownMs)
    if jerkSettled && impactQuiet && gpsWeak, let imuMag, imuMag >= config.harshBrakeMps2 {
      if let event = maybeEmit(
        type: harshyEventJerk,
        t: t,
        peak: imuMag,
        threshold: config.harshBrakeMps2,
        location: loc,
        speedMps: speed
      ) {
        emitted.append(event)
      }
    }
    return emitted
  }

  private func buildMetrics(_ t: Double) -> HarshyLiveMetrics {
    let durationMs = max(0, t - startedAtMs)
    let speedMps = currentSpeed()
    let moving = speedMps != nil && speedMps! >= config.minSpeedMps
    let levels = harshyLiveHarshLevels(
      moving: moving,
      longitudinal: longitudinalAccelMps2,
      lateral: lateralAccelMps2,
      yawRateRadps: yawRateRadps,
      config: config
    )
    let last = lastImu
    return HarshyLiveMetrics(
      t: t,
      speedMps: speedMps,
      speedKmh: speedMps.map(harshyMpsToKmh),
      headingDeg: heading.headingDeg,
      altitudeM: lastGoodLocation?.altitudeM,
      locationAccuracyM: lastGoodLocation?.accuracyM,
      longitudinalAccelMps2: longitudinalAccelMps2,
      lateralAccelMps2: lateralAccelMps2,
      verticalAccelMps2: last?.linearAccel?.z ?? last?.accel.z,
      accelMagnitudeMps2: last.map { harshyMagnitude($0.linearAccel ?? $0.accel) },
      gyroMagnitudeRadps: last?.gyro.map(harshyMagnitude),
      accelLevel: levels.accelLevel,
      brakeLevel: levels.brakeLevel,
      cornerLevel: levels.cornerLevel,
      yawRateRadps: yawRateRadps,
      swerveLevel: levels.swerveLevel,
      distanceM: distanceM,
      durationMs: durationMs,
      score: harshyScoreEvents(events, config: config, distanceM: distanceM, durationMs: durationMs)
    )
  }

  private func emitPossibleImpact(
    pending: HarshyPendingImpact,
    direction: String,
    speedMps: Double?
  ) -> HarshyDrivingEvent {
    let event = HarshyDrivingEvent(
      id: "possible_impact-\(pending.t)",
      type: harshyPossibleImpactType,
      t: pending.t,
      peak: pending.peak,
      severity: harshySeverityFromPeak(peak: pending.peak, threshold: config.impactPeakMps2),
      level: harshyEventLevel(
        peak: pending.peak,
        threshold: config.impactPeakMps2,
        mediumX: config.harshMediumX,
        heavyX: config.harshHeavyX
      ),
      lat: pending.lat,
      lon: pending.lon,
      speedMps: speedMps,
      impactDirection: direction
    )
    events.append(event)
    lastEventAt[harshyPossibleImpactType] = pending.t
    lastEventLevel[harshyPossibleImpactType] = event.level
    pendingImpact = nil
    return event
  }

  private func resolvePendingImpact(now: Double, force: Bool) -> HarshyDrivingEvent? {
    guard let pending = pendingImpact else { return nil }
    switch harshyDecidePendingImpact(
      pending: pending,
      location: location,
      now: now,
      force: force,
      config: config
    ) {
    case .wait:
      return nil
    case .discard:
      pendingImpact = nil
      return nil
    case let .emit(direction, speedMps):
      return emitPossibleImpact(pending: pending, direction: direction, speedMps: speedMps)
    }
  }

  private func acceptClosedImpactPulse(_ pulse: HarshyImpactPulse) -> HarshyDrivingEvent? {
    if pendingImpact != nil { return nil }
    switch harshyDecideClosedPulse(
      pulse: pulse,
      imu: imu,
      location: location,
      lastLat: lastGoodLocation?.lat,
      lastLon: lastGoodLocation?.lon,
      startedAtMs: startedAtMs,
      lastImpactAt: lastEventAt[harshyPossibleImpactType],
      config: config
    ) {
    case .reject:
      return nil
    case let .pending(next):
      pendingImpact = next
      return resolvePendingImpact(now: pulse.lastAboveT, force: false)
    }
  }

  private func ingestHandheldImu(_ sample: HarshyImuSample) -> [HarshyDrivingEvent] {
    let speed = currentSpeed()
    let moving = speed.map { $0 >= config.minSpeedMps } ?? false
    let stepped = harshyAdvanceHandheld(
      filter: handheld,
      open: openHandheld,
      lastClosedAt: lastEventAt[harshyPhoneHandheldType],
      sample: sample,
      moving: moving,
      speedMps: speed,
      location: lastGoodLocation,
      startedAtMs: startedAtMs,
      config: config
    )
    handheld = stepped.filter
    openHandheld = stepped.open
    if let closedAt = stepped.lastClosedAt {
      lastEventAt[harshyPhoneHandheldType] = closedAt
    }
    guard let emitted = stepped.emitted else { return [] }
    if emitted.endT == nil && !events.contains(where: { $0 === emitted }) {
      events.append(emitted)
      lastEventLevel[harshyPhoneHandheldType] = emitted.level
    } else if emitted.endT == nil {
      lastEventLevel[harshyPhoneHandheldType] = emitted.level
    }
    return [emitted]
  }

  private func flushHandheld(_ endedAtMs: Double) {
    if harshyCloseHandheldSpan(openHandheld, t: endedAtMs) != nil {
      lastEventAt[harshyPhoneHandheldType] = endedAtMs
    }
    openHandheld = nil
  }

  private func ingestImpactImu(_ sample: HarshyImuSample) -> [HarshyDrivingEvent] {
    var emitted: [HarshyDrivingEvent] = []
    if pendingImpact == nil {
      let stepped = harshyAdvanceImpactPulse(
        pulse: impactPulse,
        sample: sample,
        floorMps2: config.impactFloorMps2
      )
      impactPulse = stepped.pulse
      if let closed = stepped.closed, let event = acceptClosedImpactPulse(closed) {
        emitted.append(event)
      }
    }
    if let pending = resolvePendingImpact(now: sample.t, force: false) {
      emitted.append(pending)
    }
    return emitted
  }

  private func flushImpact(_ endedAtMs: Double) {
    if let pulse = impactPulse {
      _ = acceptClosedImpactPulse(pulse)
      impactPulse = nil
    }
    _ = resolvePendingImpact(now: endedAtMs, force: true)
  }

  private func summarizeTrip(_ endedAtMs: Double) -> HarshyTripMetrics {
    let durationMs = max(0, endedAtMs - startedAtMs)
    return HarshyTripMetrics(
      distanceM: distanceM,
      durationMs: durationMs,
      maxSpeedMps: maxSpeedMps,
      avgSpeedMps: speedCount == 0 ? nil : speedSum / Double(speedCount),
      score: harshyScoreEvents(events, config: config, distanceM: distanceM, durationMs: durationMs),
      eventCounts: harshyEventCounts(events)
    )
  }
}

public func harshyCreateTripAnalyzer(
  config: HarshyDetectorConfig?,
  sessionId: String,
  startedAtMs: Double,
  device: HarshyDeviceInfo,
  trigger: String = "manual"
) -> HarshyTripAnalyzer {
  HarshyTripAnalyzer(config: config, sessionId: sessionId, startedAtMs: startedAtMs, device: device, trigger: trigger)
}

public func harshyScoreExposureScale(
  distanceM: Double,
  durationMs _: Double,
  config: HarshyDetectorConfig
) -> Double {
  let km = max(distanceM / 1000, config.score.minDistanceKm)
  let exposure = km / config.score.refDistanceKm
  return harshyClamp(1 / max(exposure, 1e-6), 0.2, 4)
}

public func harshyScoreEvents(
  _ events: [HarshyDrivingEvent],
  config: HarshyDetectorConfig,
  distanceM: Double,
  durationMs: Double
) -> Double {
  var penalty = 0.0
  for event in events {
    penalty += harshyEventWeight(event.type, config: config) * (0.4 + 0.6 * event.severity)
    if !event.overlaps.isEmpty {
      penalty += config.score.compound
    }
  }
  let scale = harshyScoreExposureScale(distanceM: distanceM, durationMs: durationMs, config: config)
  return harshyClamp(config.score.start - penalty * scale * harshyScorePenaltyX, 0, 100)
}

public func harshyEventCounts(_ events: [HarshyDrivingEvent]) -> [String: Int] {
  var counts = harshyEmptyEventCounts()
  for event in events {
    counts[event.type, default: 0] += 1
  }
  return counts
}

public func harshyAnalyzeTrip(
  location: [HarshyLocationSample],
  imu: [HarshyImuSample],
  sessionId: String,
  startedAtMs: Double,
  endedAtMs: Double,
  device: HarshyDeviceInfo,
  config: HarshyDetectorConfig? = nil,
  trigger: String = "manual"
) -> HarshySessionExport {
  let analyzer = harshyCreateTripAnalyzer(
    config: config,
    sessionId: sessionId,
    startedAtMs: startedAtMs,
    device: device,
    trigger: trigger
  )
  let locs = location.sorted { $0.t < $1.t }
  let imus = imu.sorted { $0.t < $1.t }
  var li = 0
  var ii = 0
  while li < locs.count || ii < imus.count {
    let loc = li < locs.count ? locs[li] : nil
    let imuSample = ii < imus.count ? imus[ii] : nil
    let takeLocation = imuSample == nil || (loc != nil && loc!.t <= imuSample!.t)
    if takeLocation, let loc {
      _ = analyzer.pushLocation(loc)
      li += 1
    } else if let imuSample {
      _ = analyzer.pushImu(imuSample)
      ii += 1
    } else {
      break
    }
  }
  return analyzer.finalize(endedAtMs: endedAtMs)
}

func harshyEventWeight(_ type: String, config: HarshyDetectorConfig) -> Double {
  switch type {
  case harshyEventHarshAccel: return config.score.harshAccel
  case harshyEventHarshBrake: return config.score.harshBrake
  case harshyEventHarshCorner: return config.score.harshCorner
  case harshyEventSwerve: return config.score.swerve
  case harshyEventSpeeding: return config.score.speeding
  case harshyEventJerk: return config.score.jerk
  case harshyPossibleImpactType: return 0
  case harshyPhoneHandheldType: return 0
  default: return 0
  }
}

func harshyIsoFromEpochMs(_ ms: Double) -> String {
  let date = Date(timeIntervalSince1970: ms / 1000)
  let formatter = ISO8601DateFormatter()
  formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  return formatter.string(from: date)
}

func harshyNewSessionId() -> String {
  "trip-\(Int(Date().timeIntervalSince1970 * 1000))-\(UUID().uuidString.prefix(8))"
}
