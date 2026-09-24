import Foundation

public let harshyScorePenaltyX = 1.0 / 3.0

public struct HarshyDetectorScoreWeights: Equatable, Sendable {
  public var start: Double
  public var harshAccel: Double
  public var harshBrake: Double
  public var harshCorner: Double
  public var swerve: Double
  public var speeding: Double
  public var jerk: Double
  public var compound: Double
  public var refDistanceKm: Double
  public var refDurationMin: Double
  public var minDistanceKm: Double
  public var minDurationMin: Double

  public init(
    start: Double = 100,
    harshAccel: Double = 6,
    harshBrake: Double = 8,
    harshCorner: Double = 6,
    swerve: Double = 5,
    speeding: Double = 4,
    jerk: Double = 3,
    compound: Double = 3,
    refDistanceKm: Double = 5,
    refDurationMin: Double = 10,
    minDistanceKm: Double = 2,
    minDurationMin: Double = 5
  ) {
    self.start = start
    self.harshAccel = harshAccel
    self.harshBrake = harshBrake
    self.harshCorner = harshCorner
    self.swerve = swerve
    self.speeding = speeding
    self.jerk = jerk
    self.compound = compound
    self.refDistanceKm = refDistanceKm
    self.refDurationMin = refDurationMin
    self.minDistanceKm = minDistanceKm
    self.minDurationMin = minDurationMin
  }
}

public struct HarshyDetectorConfig: Equatable, Sendable {
  public var harshAccelMps2: Double
  public var harshBrakeMps2: Double
  public var harshCornerMps2: Double
  public var harshMediumX: Double
  public var harshHeavyX: Double
  public var harshSwerveRadps: Double
  public var speedingMps: Double?
  public var speedingExitX: Double
  public var minSpeedMps: Double
  public var cooldownMs: Double
  public var compoundWindowMs: Double
  public var jerkSettleMs: Double
  public var gpsAccelWindowMs: Double
  public var maxLocationAccuracyM: Double
  public var impactFloorMps2: Double
  public var impactPeakMps2: Double
  public var impactPeakHighMps2: Double
  public var impactPulseMaxMs: Double
  public var impactSpeedDeltaMps: Double
  public var impactLookaheadMs: Double
  public var impactCooldownMs: Double
  public var impactVerticalMax: Double
  public var impactFreeFallMps2: Double
  public var impactFreeFallLookbackMs: Double
  public var impactRolloverDeg: Double
  public var handheldTiltDeg: Double
  public var handheldExitTiltDeg: Double
  public var handheldGyroRadps: Double
  public var handheldMotionMps2: Double
  public var handheldQuietGyroRadps: Double
  public var handheldQuietMotionMps2: Double
  public var handheldStableMs: Double
  public var handheldConfirmMs: Double
  public var handheldExitMs: Double
  public var handheldCooldownMs: Double
  public var handheldBaselineAlpha: Double
  public var score: HarshyDetectorScoreWeights

  public static let `default` = HarshyDetectorConfig()

  public init(
    harshAccelMps2: Double = 2.5,
    harshBrakeMps2: Double = 3.0,
    harshCornerMps2: Double = 3.0,
    harshMediumX: Double = 1.5,
    harshHeavyX: Double = 2.0,
    harshSwerveRadps: Double = 0.45,
    speedingMps: Double? = nil,
    speedingExitX: Double = 0.95,
    minSpeedMps: Double = 2,
    cooldownMs: Double = 3500,
    compoundWindowMs: Double = 3500,
    jerkSettleMs: Double = 1500,
    gpsAccelWindowMs: Double = 1000,
    maxLocationAccuracyM: Double = 40,
    impactFloorMps2: Double = 15,
    impactPeakMps2: Double = 35,
    impactPeakHighMps2: Double = 59,
    impactPulseMaxMs: Double = 400,
    impactSpeedDeltaMps: Double = 4,
    impactLookaheadMs: Double = 2000,
    impactCooldownMs: Double = 5000,
    impactVerticalMax: Double = 0.72,
    impactFreeFallMps2: Double = 3,
    impactFreeFallLookbackMs: Double = 400,
    impactRolloverDeg: Double = 50,
    handheldTiltDeg: Double = 35,
    handheldExitTiltDeg: Double = 18,
    handheldGyroRadps: Double = 1.2,
    handheldMotionMps2: Double = 2,
    handheldQuietGyroRadps: Double = 0.25,
    handheldQuietMotionMps2: Double = 0.8,
    handheldStableMs: Double = 800,
    handheldConfirmMs: Double = 350,
    handheldExitMs: Double = 700,
    handheldCooldownMs: Double = 2500,
    handheldBaselineAlpha: Double = 0.08,
    score: HarshyDetectorScoreWeights = HarshyDetectorScoreWeights()
  ) {
    self.harshAccelMps2 = harshAccelMps2
    self.harshBrakeMps2 = harshBrakeMps2
    self.harshCornerMps2 = harshCornerMps2
    self.harshMediumX = harshMediumX
    self.harshHeavyX = harshHeavyX
    self.harshSwerveRadps = harshSwerveRadps
    self.speedingMps = speedingMps
    self.speedingExitX = speedingExitX
    self.minSpeedMps = minSpeedMps
    self.cooldownMs = cooldownMs
    self.compoundWindowMs = compoundWindowMs
    self.jerkSettleMs = jerkSettleMs
    self.gpsAccelWindowMs = gpsAccelWindowMs
    self.maxLocationAccuracyM = maxLocationAccuracyM
    self.impactFloorMps2 = impactFloorMps2
    self.impactPeakMps2 = impactPeakMps2
    self.impactPeakHighMps2 = impactPeakHighMps2
    self.impactPulseMaxMs = impactPulseMaxMs
    self.impactSpeedDeltaMps = impactSpeedDeltaMps
    self.impactLookaheadMs = impactLookaheadMs
    self.impactCooldownMs = impactCooldownMs
    self.impactVerticalMax = impactVerticalMax
    self.impactFreeFallMps2 = impactFreeFallMps2
    self.impactFreeFallLookbackMs = impactFreeFallLookbackMs
    self.impactRolloverDeg = impactRolloverDeg
    self.handheldTiltDeg = handheldTiltDeg
    self.handheldExitTiltDeg = handheldExitTiltDeg
    self.handheldGyroRadps = handheldGyroRadps
    self.handheldMotionMps2 = handheldMotionMps2
    self.handheldQuietGyroRadps = handheldQuietGyroRadps
    self.handheldQuietMotionMps2 = handheldQuietMotionMps2
    self.handheldStableMs = handheldStableMs
    self.handheldConfirmMs = handheldConfirmMs
    self.handheldExitMs = handheldExitMs
    self.handheldCooldownMs = handheldCooldownMs
    self.handheldBaselineAlpha = handheldBaselineAlpha
    self.score = score
  }
}

public func harshyMergeDetectorConfig(_ overrides: HarshyDetectorConfig?) -> HarshyDetectorConfig {
  overrides ?? HarshyDetectorConfig.default
}
