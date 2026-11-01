import Foundation

/// Relative energy coefficients for a generic car (not liters). Mirrors core `GENERIC_CAR_ECO`.
public struct HarshyEcoProfile: Equatable, Sendable {
  public var id: String
  public var rolling: Double
  public var aero: Double
  public var accel: Double
  public var vEffMps: Double
  public var minDistanceM: Double
  public var minSegments: Int

  public init(
    id: String = "generic",
    rolling: Double = 1,
    aero: Double = 0.002,
    accel: Double = 1.5,
    vEffMps: Double = 50 / 3.6,
    minDistanceM: Double = 50,
    minSegments: Int = 1
  ) {
    self.id = id
    self.rolling = rolling
    self.aero = aero
    self.accel = accel
    self.vEffMps = vEffMps
    self.minDistanceM = minDistanceM
    self.minSegments = minSegments
  }
}

public let harshyGenericCarEco = HarshyEcoProfile()

public struct HarshyTripEcoEstimate: Equatable, Sendable {
  public var ecoScore: Double?
  public var ecoRatio: Double?
  public var ecoEnergy: Double?
  public var ecoOptimal: Double?
  public var vehicleProfileId: String
}

/// Map consumption ratio to 0–100. ratio 1 → 100, 2 → 50, 3 → 0.
public func harshyEcoScoreFromRatio(_ ratio: Double) -> Double {
  guard ratio.isFinite, ratio > 0 else {
    return 100
  }
  return max(0, min(100, (100 * (3 - ratio) / 2).rounded()))
}

/**
 Estimate relative fuel energy and eco score from a GPS path.
 Does not use IMU. Does not affect driving-quality points/score.
 */
public func harshyEstimateTripEco(
  _ samples: [HarshyLocationSample],
  distanceM: Double? = nil,
  profile: HarshyEcoProfile = harshyGenericCarEco
) -> HarshyTripEcoEstimate {
  let empty = HarshyTripEcoEstimate(
    ecoScore: nil,
    ecoRatio: nil,
    ecoEnergy: nil,
    ecoOptimal: nil,
    vehicleProfileId: profile.id
  )
  guard samples.count >= 2 else {
    return empty
  }

  var energy = 0.0
  var pathDistanceM = 0.0
  var segments = 0

  for i in 1..<samples.count {
    let prev = samples[i - 1]
    let next = samples[i]
    let dtSec = (next.t - prev.t) / 1000
    guard dtSec.isFinite, dtSec >= 0.05, dtSec <= 60 else {
      continue
    }
    let v0 = harshyEcoSpeed(prev)
    let v1 = harshyEcoSpeed(next)
    guard v0 != nil || v1 != nil else {
      continue
    }
    let v: Double
    if let a = v0, let b = v1 {
      v = (a + b) / 2
    } else {
      v = v0 ?? v1!
    }
    let stepM = harshyHaversineM(prev, next)
    guard stepM.isFinite, stepM >= 0 else {
      continue
    }
    let dist = stepM > 0.05 ? stepM : max(0, v * dtSec)
    if dist <= 0, v < 0.3 {
      continue
    }
    var a = 0.0
    if let s0 = v0, let s1 = v1 {
      a = (s1 - s0) / dtSec
      if !a.isFinite {
        a = 0
      }
    }
    energy += profile.rolling * dist
    energy += profile.aero * v * v * v * dtSec
    energy += profile.accel * max(a, 0) * v * dtSec
    pathDistanceM += dist
    segments += 1
  }

  let distance: Double
  if let provided = distanceM, provided.isFinite, provided > 0 {
    distance = provided
  } else {
    distance = pathDistanceM
  }
  guard segments >= profile.minSegments, distance >= profile.minDistanceM, energy > 0 else {
    return empty
  }

  let vEff = profile.vEffMps
  let optimal = profile.rolling * distance + profile.aero * vEff * vEff * distance
  guard optimal > 0 else {
    return empty
  }
  let ratio = energy / optimal
  return HarshyTripEcoEstimate(
    ecoScore: harshyEcoScoreFromRatio(ratio),
    ecoRatio: ratio,
    ecoEnergy: energy,
    ecoOptimal: optimal,
    vehicleProfileId: profile.id
  )
}

private func harshyEcoSpeed(_ sample: HarshyLocationSample) -> Double? {
  guard let v = sample.speedMps, v.isFinite, v >= 0 else {
    return nil
  }
  return v
}
