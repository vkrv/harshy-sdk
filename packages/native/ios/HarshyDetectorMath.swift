import Foundation

let harshyEarthRadiusM = 6_371_000.0
let harshyCompoundEventTypes: Set<String> = [
  harshyEventHarshAccel,
  harshyEventHarshBrake,
  harshyEventHarshCorner,
  harshyEventSwerve,
  harshyEventSpeeding,
]

func harshyToRad(_ deg: Double) -> Double { (deg * .pi) / 180 }

func harshyToDeg(_ rad: Double) -> Double { (rad * 180) / .pi }

func harshyHaversineM(_ a: HarshyLocationSample, _ b: HarshyLocationSample) -> Double {
  let dLat = harshyToRad(b.lat - a.lat)
  let dLon = harshyToRad(b.lon - a.lon)
  let lat1 = harshyToRad(a.lat)
  let lat2 = harshyToRad(b.lat)
  let h =
    pow(sin(dLat / 2), 2) +
    cos(lat1) * cos(lat2) * pow(sin(dLon / 2), 2)
  return 2 * harshyEarthRadiusM * asin(min(1, sqrt(h)))
}

let harshyDriveFixMaxSpeedMps = 55.0
let harshyDriveFixMaxStepM = 80.0
let harshyDriveFixResetAfter = 10
let harshyDriveFixCoarseFractionDigits = 7
let harshyDriveFixGnssAccuracyM = 50.0
/// 10 km/h. Matches core `startSpeedMps`.
let harshyWatchVehicleSpeedMps = 10.0 / 3.6

func harshyCoordinateFractionDigits(_ value: Double) -> Int {
  guard value.isFinite else { return 0 }
  let text = String(value)
  guard let dot = text.firstIndex(of: ".") else { return 0 }
  return text.distance(from: text.index(after: dot), to: text.endIndex)
}

func harshyDerivedSpeedMps(
  from: HarshyLocationSample?,
  to: HarshyLocationSample,
  maxDtSec: Double = 60
) -> Double? {
  if let reported = to.speedMps, reported.isFinite, reported >= 0 {
    return reported
  }
  guard let from else { return nil }
  let dtSec = (to.t - from.t) / 1000
  guard dtSec.isFinite, dtSec >= 0.05, dtSec <= maxDtSec else { return nil }
  let speed = harshyHaversineM(from, to) / dtSec
  return speed.isFinite ? speed : nil
}

let harshyDerivedCourseMinM = 2.0
let harshyGpsAccelMinDtSec = 0.2
let harshyGpsAccelMaxDtSec = 8.0

func harshyDerivedCourseDeg(
  from: HarshyLocationSample?,
  to: HarshyLocationSample,
  maxDtSec: Double = 60,
  minDistanceM: Double = harshyDerivedCourseMinM
) -> Double? {
  if let reported = to.courseDeg, reported.isFinite {
    return harshyWrapCourseDeg(reported)
  }
  guard let from else { return nil }
  let dtSec = (to.t - from.t) / 1000
  guard dtSec.isFinite, dtSec >= 0.05, dtSec <= maxDtSec else { return nil }
  guard harshyHaversineM(from, to) >= minDistanceM else { return nil }
  let y = sin(harshyToRad(to.lon - from.lon)) * cos(harshyToRad(to.lat))
  let x =
    cos(harshyToRad(from.lat)) * sin(harshyToRad(to.lat)) -
    sin(harshyToRad(from.lat)) * cos(harshyToRad(to.lat)) * cos(harshyToRad(to.lon - from.lon))
  let deg = harshyToDeg(atan2(y, x))
  return deg.isFinite ? harshyWrapCourseDeg(deg) : nil
}

func harshyWatchKinematicActivity(_ activity: String, speedMps: Double?) -> String {
  guard let speed = speedMps, speed >= harshyWatchVehicleSpeedMps else {
    return activity
  }
  if activity == "walking" || activity == "running" {
    return "unknown"
  }
  return activity
}

func harshyIsCoarseNetworkLikeFix(_ sample: HarshyLocationSample) -> Bool {
  if sample.speedMps != nil { return false }
  if let accuracy = sample.accuracyM, accuracy.isFinite, accuracy <= harshyDriveFixGnssAccuracyM {
    return false
  }
  return harshyCoordinateFractionDigits(sample.lat) <= harshyDriveFixCoarseFractionDigits ||
    harshyCoordinateFractionDigits(sample.lon) <= harshyDriveFixCoarseFractionDigits
}

func harshyIsPlausibleDriveStep(_ from: HarshyLocationSample, _ to: HarshyLocationSample) -> Bool {
  let dtMs = max(0, to.t - from.t)
  let dtSec = max(dtMs / 1000, 0.05)
  let reported = max(from.speedMps ?? 0, to.speedMps ?? 0)
  let cap = max(harshyDriveFixMaxSpeedMps, reported * 1.35 + 8)
  let limit = cap * dtSec
  return harshyHaversineM(from, to) <= limit
}

struct HarshyDriveFixDecision {
  var accept: Bool
  var rejects: Int
}

func harshyShouldAcceptDriveFix(
  anchor: HarshyLocationSample?,
  sample: HarshyLocationSample,
  consecutiveRejects: Int
) -> HarshyDriveFixDecision {
  if harshyIsCoarseNetworkLikeFix(sample) {
    return HarshyDriveFixDecision(accept: false, rejects: consecutiveRejects)
  }
  guard let anchor else {
    return HarshyDriveFixDecision(accept: true, rejects: 0)
  }
  if harshyIsPlausibleDriveStep(anchor, sample) {
    return HarshyDriveFixDecision(accept: true, rejects: 0)
  }
  let rejects = consecutiveRejects + 1
  if rejects >= harshyDriveFixResetAfter {
    return HarshyDriveFixDecision(accept: true, rejects: 0)
  }
  return HarshyDriveFixDecision(accept: false, rejects: rejects)
}

func harshyUnwrapDeltaDeg(fromDeg: Double, toDeg: Double) -> Double {
  var delta = toDeg - fromDeg
  while delta > 180 { delta -= 360 }
  while delta < -180 { delta += 360 }
  return delta
}

let harshyHeadingConfirmSamples = 2
let harshyHeadingConfirmBandDeg = 35.0
let harshyHeadingSmoothTauMs = 800.0
let harshyHeadingPublishDeg = 3.0

struct HarshyHeadingFilter {
  var headingDeg: Double?
  var smoothedDeg: Double?
  var atMs: Double?
  var pendingDeg: Double?
  var pendingCount: Int
  var held: Bool
}

func harshyEmptyHeadingFilter() -> HarshyHeadingFilter {
  HarshyHeadingFilter(
    headingDeg: nil,
    smoothedDeg: nil,
    atMs: nil,
    pendingDeg: nil,
    pendingCount: 0,
    held: false
  )
}

func harshyWrapCourseDeg(_ deg: Double) -> Double {
  var wrapped = deg.truncatingRemainder(dividingBy: 360)
  if wrapped < 0 { wrapped += 360 }
  return wrapped
}

func harshyAdvanceHeadingFilter(
  _ prev: HarshyHeadingFilter,
  sample: HarshyLocationSample,
  minSpeedMps: Double
) -> HarshyHeadingFilter {
  guard let course = sample.courseDeg, course.isFinite else { return prev }
  let courseDeg = harshyWrapCourseDeg(course)
  let moving = sample.speedMps.map { $0 >= minSpeedMps } ?? false
  if !moving {
    return HarshyHeadingFilter(
      headingDeg: prev.headingDeg,
      smoothedDeg: prev.smoothedDeg,
      atMs: prev.atMs,
      pendingDeg: nil,
      pendingCount: 0,
      held: prev.headingDeg != nil
    )
  }

  let needsConfirm = prev.headingDeg == nil || prev.held
  if needsConfirm {
    let stepped = harshyStepHeadingConfirm(
      pendingDeg: prev.pendingDeg,
      pendingCount: prev.pendingCount,
      courseDeg: courseDeg
    )
    guard let confirmed = stepped.confirmedDeg else {
      var next = prev
      next.pendingDeg = stepped.pendingDeg
      next.pendingCount = stepped.pendingCount
      return next
    }
    return HarshyHeadingFilter(
      headingDeg: harshyMaybePublishHeading(prev.headingDeg, confirmed),
      smoothedDeg: confirmed,
      atMs: sample.t,
      pendingDeg: nil,
      pendingCount: 0,
      held: false
    )
  }

  let from = prev.smoothedDeg ?? prev.headingDeg ?? courseDeg
  let dtMs: Double
  if let atMs = prev.atMs {
    dtMs = max(0, sample.t - atMs)
  } else {
    dtMs = harshyHeadingSmoothTauMs
  }
  let smoothedDeg = harshySmoothHeadingToward(from: from, to: courseDeg, dtMs: dtMs)
  return HarshyHeadingFilter(
    headingDeg: harshyMaybePublishHeading(prev.headingDeg, smoothedDeg),
    smoothedDeg: smoothedDeg,
    atMs: sample.t,
    pendingDeg: nil,
    pendingCount: 0,
    held: false
  )
}

private struct HarshyHeadingConfirmStep {
  var pendingDeg: Double
  var pendingCount: Int
  var confirmedDeg: Double?
}

private func harshyStepHeadingConfirm(
  pendingDeg: Double?,
  pendingCount: Int,
  courseDeg: Double
) -> HarshyHeadingConfirmStep {
  guard let pendingDeg, pendingCount > 0 else {
    return HarshyHeadingConfirmStep(pendingDeg: courseDeg, pendingCount: 1, confirmedDeg: nil)
  }
  let delta = harshyUnwrapDeltaDeg(fromDeg: pendingDeg, toDeg: courseDeg)
  if abs(delta) > harshyHeadingConfirmBandDeg {
    return HarshyHeadingConfirmStep(pendingDeg: courseDeg, pendingCount: 1, confirmedDeg: nil)
  }
  let blended = harshyWrapCourseDeg(pendingDeg + delta / 2)
  let count = pendingCount + 1
  if count < harshyHeadingConfirmSamples {
    return HarshyHeadingConfirmStep(pendingDeg: blended, pendingCount: count, confirmedDeg: nil)
  }
  return HarshyHeadingConfirmStep(pendingDeg: blended, pendingCount: 0, confirmedDeg: blended)
}

private func harshySmoothHeadingToward(from: Double, to: Double, dtMs: Double) -> Double {
  let alpha = dtMs <= 0 ? 1.0 : 1.0 - exp(-dtMs / harshyHeadingSmoothTauMs)
  return harshyWrapCourseDeg(from + alpha * harshyUnwrapDeltaDeg(fromDeg: from, toDeg: to))
}

private func harshyMaybePublishHeading(_ published: Double?, _ smoothed: Double) -> Double {
  guard let published else { return smoothed }
  if abs(harshyUnwrapDeltaDeg(fromDeg: published, toDeg: smoothed)) >= harshyHeadingPublishDeg {
    return smoothed
  }
  return published
}

func harshyMagnitude(_ vector: HarshyVec3) -> Double {
  hypot(hypot(vector.x, vector.y), vector.z)
}

func harshyMpsToKmh(_ mps: Double) -> Double { mps * 3.6 }

func harshyClamp(_ value: Double, _ minValue: Double, _ maxValue: Double) -> Double {
  min(maxValue, max(minValue, value))
}

func harshySeverityFromPeak(peak: Double, threshold: Double) -> Double {
  if threshold <= 0 { return 1 }
  return harshyClamp((peak - threshold) / threshold, 0, 1)
}

func harshyLevelRank(_ level: String) -> Int {
  switch level {
  case "norm": return 0
  case "light": return 1
  case "medium": return 2
  default: return 3
  }
}

func harshyLevel(peak: Double, threshold: Double, mediumX: Double, heavyX: Double) -> String {
  if !(peak > 0) || threshold <= 0 || peak < threshold {
    return "norm"
  }
  let ratio = peak / threshold
  if ratio >= heavyX { return "heavy" }
  if ratio >= mediumX { return "medium" }
  return "light"
}

func harshyEventLevel(peak: Double, threshold: Double, mediumX: Double, heavyX: Double) -> String {
  let level = harshyLevel(peak: peak, threshold: threshold, mediumX: mediumX, heavyX: heavyX)
  return level == "norm" ? "light" : level
}

struct HarshyLiveHarshLevels {
  var accelLevel: String
  var brakeLevel: String
  var cornerLevel: String
  var swerveLevel: String
}

func harshyLiveHarshLevels(
  moving: Bool,
  longitudinal: Double?,
  lateral: Double?,
  yawRateRadps: Double?,
  config: HarshyDetectorConfig
) -> HarshyLiveHarshLevels {
  if !moving {
    return HarshyLiveHarshLevels(accelLevel: "norm", brakeLevel: "norm", cornerLevel: "norm", swerveLevel: "norm")
  }
  let accelPeak = (longitudinal ?? 0) > 0 ? (longitudinal ?? 0) : 0
  let brakePeak = (longitudinal ?? 0) < 0 ? -(longitudinal ?? 0) : 0
  let cornerPeak = abs(lateral ?? 0)
  let swervePeak = abs(yawRateRadps ?? 0)
  return HarshyLiveHarshLevels(
    accelLevel: harshyLevel(peak: accelPeak, threshold: config.harshAccelMps2, mediumX: config.harshMediumX, heavyX: config.harshHeavyX),
    brakeLevel: harshyLevel(peak: brakePeak, threshold: config.harshBrakeMps2, mediumX: config.harshMediumX, heavyX: config.harshHeavyX),
    cornerLevel: harshyLevel(peak: cornerPeak, threshold: config.harshCornerMps2, mediumX: config.harshMediumX, heavyX: config.harshHeavyX),
    swerveLevel: harshyLevel(peak: swervePeak, threshold: config.harshSwerveRadps, mediumX: config.harshMediumX, heavyX: config.harshHeavyX)
  )
}

func harshyIsCompoundType(_ type: String) -> Bool {
  harshyCompoundEventTypes.contains(type)
}

func harshyAddOverlap(_ event: HarshyDrivingEvent, _ type: String) {
  if event.type == type || event.overlaps.contains(type) { return }
  event.overlaps.append(type)
}

func harshyEventSpanEnd(_ event: HarshyDrivingEvent, now: Double) -> Double {
  if let endT = event.endT { return endT }
  if event.type == harshyEventSpeeding { return now }
  return event.t
}

func harshyEventsOverlap(_ a: HarshyDrivingEvent, _ b: HarshyDrivingEvent, now: Double, windowMs: Double) -> Bool {
  let a0 = a.t
  let a1 = harshyEventSpanEnd(a, now: now)
  let b0 = b.t
  let b1 = harshyEventSpanEnd(b, now: now)
  return a0 - windowMs <= b1 && b0 <= a1 + windowMs
}

func harshyTagCompoundOverlaps(
  events: [HarshyDrivingEvent],
  incoming: HarshyDrivingEvent,
  now: Double,
  windowMs: Double
) {
  if !harshyIsCompoundType(incoming.type) { return }
  for other in events {
    if other.id == incoming.id { continue }
    if !harshyIsCompoundType(other.type) || other.type == incoming.type { continue }
    if !harshyEventsOverlap(incoming, other, now: now, windowMs: windowMs) { continue }
    harshyAddOverlap(incoming, other.type)
    harshyAddOverlap(other, incoming.type)
  }
}

let harshyRoadWindowMs = 1000.0

func harshyVerticalLinearAccel(_ sample: HarshyImuSample) -> Double {
  let linear = sample.linearAccel
  let accel = linear ?? sample.accel
  if let gravity = sample.gravity {
    let mag = harshyMagnitude(gravity)
    if mag > 0.5 {
      let projected = (accel.x * gravity.x + accel.y * gravity.y + accel.z * gravity.z) / mag
      return abs(linear != nil ? projected : projected - mag)
    }
  }
  return abs(linear?.z ?? sample.accel.z)
}

func harshyAssessRoad(
  location: [HarshyLocationSample],
  imu: [HarshyImuSample],
  startedAtMs: Double,
  jerkSettleMs: Double,
  minSpeedMps: Double,
  windowMs: Double = harshyRoadWindowMs
) -> [HarshyLocationSample] {
  let settleUntil = startedAtMs + jerkSettleMs
  if imu.isEmpty {
    return location.map { sample in
      var copy = sample
      copy.roadRmsMps2 = sample.roadRmsMps2
      return copy
    }
  }
  let samples = imu.sorted { $0.t < $1.t }
  var start = 0
  return location.map { sample in
    var next = sample
    if sample.roadRmsMps2 != nil {
      return sample
    }
    let speed = sample.speedMps ?? 0
    if sample.t < settleUntil || speed < minSpeedMps {
      next.roadRmsMps2 = nil
      return next
    }
    let lo = sample.t - windowMs
    let hi = sample.t
    while start < samples.count && samples[start].t < lo {
      start += 1
    }
    var sumSq = 0.0
    var n = 0
    var i = start
    while i < samples.count {
      let imuSample = samples[i]
      if imuSample.t > hi { break }
      if imuSample.t >= settleUntil {
        let vertical = harshyVerticalLinearAccel(imuSample)
        sumSq += vertical * vertical
        n += 1
      }
      i += 1
    }
    next.roadRmsMps2 = n == 0 ? nil : sqrt(sumSq / Double(n))
    return next
  }
}

struct HarshyImpactPulse {
  var startT: Double
  var lastAboveT: Double
  var peakT: Double
  var peakMag: Double
  var peakLinear: HarshyVec3
  var gravityStart: HarshyVec3?
  var gravityPeak: HarshyVec3?
  var gravityLast: HarshyVec3?
}

struct HarshyPendingImpact {
  var t: Double
  var peak: Double
  var rollover: Bool
  var lat: Double?
  var lon: Double?
  var speedBeforeMps: Double?
}

enum HarshyClosedPulseDecision {
  case reject
  case pending(HarshyPendingImpact)
}

enum HarshyPendingImpactDecision {
  case wait
  case discard
  case emit(direction: String, speedMps: Double?)
}

func harshyCopyVec(_ vector: HarshyVec3) -> HarshyVec3 {
  HarshyVec3(x: vector.x, y: vector.y, z: vector.z)
}

func harshySampleLinearAccel(_ sample: HarshyImuSample) -> HarshyVec3 {
  if let linear = sample.linearAccel { return linear }
  if let gravity = sample.gravity {
    return HarshyVec3(
      x: sample.accel.x - gravity.x,
      y: sample.accel.y - gravity.y,
      z: sample.accel.z - gravity.z
    )
  }
  return sample.accel
}

func harshyVerticalShare(linear: HarshyVec3, gravity: HarshyVec3?) -> Double {
  let accelMag = harshyMagnitude(linear)
  if accelMag < 1e-6 { return 0 }
  guard let gravity else {
    return abs(linear.z) / accelMag
  }
  let gravityMag = harshyMagnitude(gravity)
  if gravityMag < 0.5 { return 0 }
  return abs(linear.x * gravity.x + linear.y * gravity.y + linear.z * gravity.z) /
    (accelMag * gravityMag)
}

func harshyGravityTiltDeg(from: HarshyVec3?, to: HarshyVec3?) -> Double {
  guard let from, let to else { return 0 }
  let fromMag = harshyMagnitude(from)
  let toMag = harshyMagnitude(to)
  if fromMag < 0.5 || toMag < 0.5 { return 0 }
  let dot = harshyClamp(
    (from.x * to.x + from.y * to.y + from.z * to.z) / (fromMag * toMag),
    -1,
    1
  )
  return (acos(dot) * 180) / .pi
}

func harshyLocationSpeedUsable(_ sample: HarshyLocationSample, maxLocationAccuracyM: Double) -> Double? {
  guard let speed = sample.speedMps else { return nil }
  if let accuracy = sample.accuracyM, accuracy > maxLocationAccuracyM { return nil }
  return speed
}

func harshyLastUsableSpeedInWindow(
  location: [HarshyLocationSample],
  lo: Double,
  hi: Double,
  maxLocationAccuracyM: Double
) -> Double? {
  for sample in location.reversed() {
    if sample.t > hi { continue }
    if sample.t < lo { break }
    if let speed = harshyLocationSpeedUsable(sample, maxLocationAccuracyM: maxLocationAccuracyM) {
      return speed
    }
  }
  return nil
}

func harshyHadFreeFall(
  imu: [HarshyImuSample],
  pulseStartT: Double,
  lookbackMs: Double,
  freeFallMps2: Double
) -> Bool {
  let lo = pulseStartT - lookbackMs
  for sample in imu.reversed() {
    if sample.t >= pulseStartT { continue }
    if sample.t < lo { break }
    if harshyMagnitude(sample.accel) < freeFallMps2 { return true }
  }
  return false
}

func harshyClassifyImpactDirection(rollover: Bool, speedDeltaMps: Double?, speedDeltaMin: Double) -> String {
  if rollover { return "rollover" }
  guard let speedDeltaMps, speedDeltaMin > 0 else { return "unknown" }
  if speedDeltaMps <= -speedDeltaMin { return "front" }
  if speedDeltaMps >= speedDeltaMin { return "rear" }
  return "unknown"
}

func harshyAdvanceImpactPulse(
  pulse: HarshyImpactPulse?,
  sample: HarshyImuSample,
  floorMps2: Double
) -> (pulse: HarshyImpactPulse?, closed: HarshyImpactPulse?) {
  let linear = harshySampleLinearAccel(sample)
  let mag = harshyMagnitude(linear)
  if mag >= floorMps2 {
    guard var pulse else {
      return (
        HarshyImpactPulse(
          startT: sample.t,
          lastAboveT: sample.t,
          peakT: sample.t,
          peakMag: mag,
          peakLinear: harshyCopyVec(linear),
          gravityStart: sample.gravity.map(harshyCopyVec),
          gravityPeak: sample.gravity.map(harshyCopyVec),
          gravityLast: sample.gravity.map(harshyCopyVec)
        ),
        nil
      )
    }
    pulse.lastAboveT = sample.t
    pulse.gravityLast = sample.gravity.map(harshyCopyVec) ?? pulse.gravityLast
    if mag > pulse.peakMag {
      pulse.peakMag = mag
      pulse.peakT = sample.t
      pulse.peakLinear = harshyCopyVec(linear)
      pulse.gravityPeak = sample.gravity.map(harshyCopyVec) ?? pulse.gravityPeak
    }
    return (pulse, nil)
  }
  if let pulse {
    return (nil, pulse)
  }
  return (nil, nil)
}

func harshyDecideClosedPulse(
  pulse: HarshyImpactPulse,
  imu: [HarshyImuSample],
  location: [HarshyLocationSample],
  lastLat: Double?,
  lastLon: Double?,
  startedAtMs: Double,
  lastImpactAt: Double?,
  config: HarshyDetectorConfig
) -> HarshyClosedPulseDecision {
  let width = pulse.lastAboveT - pulse.startT
  if width > config.impactPulseMaxMs { return .reject }
  if pulse.peakMag < config.impactPeakMps2 { return .reject }
  if pulse.startT - startedAtMs < config.jerkSettleMs { return .reject }
  if let lastImpactAt, pulse.peakT - lastImpactAt < config.impactCooldownMs { return .reject }
  if harshyHadFreeFall(
    imu: imu,
    pulseStartT: pulse.startT,
    lookbackMs: config.impactFreeFallLookbackMs,
    freeFallMps2: config.impactFreeFallMps2
  ) {
    return .reject
  }
  if harshyVerticalShare(linear: pulse.peakLinear, gravity: pulse.gravityPeak) > config.impactVerticalMax {
    return .reject
  }
  let speedBefore = harshyLastUsableSpeedInWindow(
    location: location,
    lo: pulse.peakT - config.impactLookaheadMs,
    hi: pulse.peakT,
    maxLocationAccuracyM: config.maxLocationAccuracyM
  )
  guard let speedBefore, speedBefore >= config.minSpeedMps else { return .reject }
  let rollover =
    harshyGravityTiltDeg(from: pulse.gravityStart, to: pulse.gravityLast ?? pulse.gravityPeak) >=
    config.impactRolloverDeg
  return .pending(
    HarshyPendingImpact(
      t: pulse.peakT,
      peak: pulse.peakMag,
      rollover: rollover,
      lat: lastLat,
      lon: lastLon,
      speedBeforeMps: speedBefore
    )
  )
}

func harshyDecidePendingImpact(
  pending: HarshyPendingImpact,
  location: [HarshyLocationSample],
  now: Double,
  force: Bool,
  config: HarshyDetectorConfig
) -> HarshyPendingImpactDecision {
  let speedAfter = harshyLastUsableSpeedInWindow(
    location: location,
    lo: pending.t + 1,
    hi: pending.t + config.impactLookaheadMs,
    maxLocationAccuracyM: config.maxLocationAccuracyM
  )
  let speedDelta: Double?
  if let before = pending.speedBeforeMps, let after = speedAfter {
    speedDelta = after - before
  } else {
    speedDelta = nil
  }
  let gpsConfirms =
    speedDelta != nil &&
    config.impactSpeedDeltaMps > 0 &&
    abs(speedDelta!) >= config.impactSpeedDeltaMps
  let skipGps = config.impactSpeedDeltaMps <= 0
  let highPeak = pending.peak >= config.impactPeakHighMps2
  let lookaheadElapsed = now >= pending.t + config.impactLookaheadMs
  if pending.rollover || gpsConfirms || highPeak || skipGps {
    return .emit(
      direction: harshyClassifyImpactDirection(
        rollover: pending.rollover,
        speedDeltaMps: speedDelta,
        speedDeltaMin: config.impactSpeedDeltaMps
      ),
      speedMps: speedAfter ?? pending.speedBeforeMps
    )
  }
  if lookaheadElapsed || force { return .discard }
  return .wait
}
