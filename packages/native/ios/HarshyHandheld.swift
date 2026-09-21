import Foundation

public let harshyPhoneHandheldType = "phone_handheld"

public let harshyDefaultHandheldTiltDeg = 35.0
public let harshyDefaultHandheldExitTiltDeg = 18.0
public let harshyDefaultHandheldGyroRadps = 1.2
public let harshyDefaultHandheldMotionMps2 = 2.0
public let harshyDefaultHandheldQuietGyroRadps = 0.25
public let harshyDefaultHandheldQuietMotionMps2 = 0.8
public let harshyDefaultHandheldStableMs = 800.0
public let harshyDefaultHandheldConfirmMs = 350.0
public let harshyDefaultHandheldExitMs = 700.0
public let harshyDefaultHandheldCooldownMs = 2500.0
public let harshyDefaultHandheldBaselineAlpha = 0.08

public func harshyIsPhoneHandheld(_ event: HarshyDrivingEvent) -> Bool {
  event.type == harshyPhoneHandheldType
}

struct HarshyHandheldFilter {
  var baseline: HarshyVec3?
  var quietSince: Double?
  var candidateSince: Double?
  var belowExitSince: Double?
}

struct HarshyHandheldStep {
  var filter: HarshyHandheldFilter
  var open: HarshyDrivingEvent?
  var emitted: HarshyDrivingEvent?
  var lastClosedAt: Double?
}

func harshyEmptyHandheldFilter() -> HarshyHandheldFilter {
  HarshyHandheldFilter(baseline: nil, quietSince: nil, candidateSince: nil, belowExitSince: nil)
}

private func harshyBlendBaseline(_ previous: HarshyVec3?, gravity: HarshyVec3, alpha: Double) -> HarshyVec3 {
  guard let previous else { return harshyCopyVec(gravity) }
  return HarshyVec3(
    x: previous.x + (gravity.x - previous.x) * alpha,
    y: previous.y + (gravity.y - previous.y) * alpha,
    z: previous.z + (gravity.z - previous.z) * alpha
  )
}

func harshyAdvanceHandheld(
  filter: HarshyHandheldFilter,
  open: HarshyDrivingEvent?,
  lastClosedAt: Double?,
  sample: HarshyImuSample,
  moving: Bool,
  speedMps: Double?,
  location: HarshyLocationSample?,
  startedAtMs: Double,
  config: HarshyDetectorConfig
) -> HarshyHandheldStep {
  var next = filter
  var nextOpen = open
  var nextClosedAt = lastClosedAt
  var emitted: HarshyDrivingEvent?

  guard let gravity = sample.gravity, harshyMagnitude(gravity) >= 0.5 else {
    return HarshyHandheldStep(filter: next, open: nextOpen, emitted: emitted, lastClosedAt: nextClosedAt)
  }

  let gyroMag = sample.gyro.map(harshyMagnitude) ?? 0
  let linearMag = harshyMagnitude(harshySampleLinearAccel(sample))
  let quiet =
    gyroMag < config.handheldQuietGyroRadps && linearMag < config.handheldQuietMotionMps2

  if nextOpen == nil && quiet {
    if next.quietSince == nil {
      next.quietSince = sample.t
    }
    if sample.t - (next.quietSince ?? sample.t) >= config.handheldStableMs {
      next.baseline = harshyBlendBaseline(
        next.baseline,
        gravity: gravity,
        alpha: next.baseline == nil ? 1 : config.handheldBaselineAlpha
      )
    }
  } else if nextOpen == nil {
    next.quietSince = nil
  }

  let settled = sample.t - startedAtMs >= config.jerkSettleMs
  if !settled || next.baseline == nil {
    next.candidateSince = nil
    return HarshyHandheldStep(filter: next, open: nextOpen, emitted: emitted, lastClosedAt: nextClosedAt)
  }

  let tilt = harshyGravityTiltDeg(from: next.baseline, to: gravity)

  if let openEvent = nextOpen {
    if tilt > openEvent.peak {
      openEvent.peak = tilt
      openEvent.severity = harshySeverityFromPeak(peak: tilt, threshold: config.handheldTiltDeg)
      openEvent.level = harshyEventLevel(
        peak: tilt,
        threshold: config.handheldTiltDeg,
        mediumX: config.harshMediumX,
        heavyX: config.harshHeavyX
      )
      openEvent.lat = location?.lat ?? openEvent.lat
      openEvent.lon = location?.lon ?? openEvent.lon
      openEvent.speedMps = speedMps
      emitted = openEvent
    }
    let shouldExit = !moving || tilt < config.handheldExitTiltDeg
    if shouldExit {
      if next.belowExitSince == nil {
        next.belowExitSince = sample.t
      }
      if sample.t - (next.belowExitSince ?? sample.t) >= config.handheldExitMs {
        openEvent.endT = sample.t
        nextClosedAt = sample.t
        emitted = openEvent
        nextOpen = nil
        next.candidateSince = nil
        next.belowExitSince = nil
        next.quietSince = nil
      }
    } else {
      next.belowExitSince = nil
    }
    return HarshyHandheldStep(filter: next, open: nextOpen, emitted: emitted, lastClosedAt: nextClosedAt)
  }

  if !moving {
    next.candidateSince = nil
    next.belowExitSince = nil
    return HarshyHandheldStep(filter: next, open: nextOpen, emitted: emitted, lastClosedAt: nextClosedAt)
  }

  if let closedAt = nextClosedAt, sample.t - closedAt < config.handheldCooldownMs {
    next.candidateSince = nil
    return HarshyHandheldStep(filter: next, open: nextOpen, emitted: emitted, lastClosedAt: nextClosedAt)
  }

  let handling =
    gyroMag >= config.handheldGyroRadps || linearMag >= config.handheldMotionMps2
  if tilt >= config.handheldTiltDeg && handling && next.candidateSince == nil {
    next.candidateSince = sample.t
  }
  if let candidateSince = next.candidateSince, tilt >= config.handheldTiltDeg {
    if sample.t - candidateSince >= config.handheldConfirmMs {
      let opened = HarshyDrivingEvent(
        id: "\(harshyPhoneHandheldType)-\(sample.t)",
        type: harshyPhoneHandheldType,
        t: candidateSince,
        endT: nil,
        peak: tilt,
        severity: harshySeverityFromPeak(peak: tilt, threshold: config.handheldTiltDeg),
        level: harshyEventLevel(
          peak: tilt,
          threshold: config.handheldTiltDeg,
          mediumX: config.harshMediumX,
          heavyX: config.harshHeavyX
        ),
        lat: location?.lat,
        lon: location?.lon,
        speedMps: speedMps
      )
      nextOpen = opened
      emitted = opened
      next.candidateSince = nil
      next.belowExitSince = nil
    }
  } else {
    next.candidateSince = nil
  }

  return HarshyHandheldStep(filter: next, open: nextOpen, emitted: emitted, lastClosedAt: nextClosedAt)
}

func harshyCloseHandheldSpan(_ open: HarshyDrivingEvent?, t: Double) -> HarshyDrivingEvent? {
  guard let open, open.endT == nil else { return nil }
  open.endT = t
  return open
}
