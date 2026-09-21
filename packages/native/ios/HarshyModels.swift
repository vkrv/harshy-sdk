import Foundation

public struct HarshyVec3: Equatable, Sendable {
  public var x: Double
  public var y: Double
  public var z: Double

  public init(x: Double, y: Double, z: Double) {
    self.x = x
    self.y = y
    self.z = z
  }
}

public struct HarshyAttitude: Equatable, Sendable {
  public var pitch: Double
  public var roll: Double
  public var yaw: Double

  public init(pitch: Double, roll: Double, yaw: Double) {
    self.pitch = pitch
    self.roll = roll
    self.yaw = yaw
  }
}

public struct HarshyLocationSample: Equatable, Sendable {
  public var t: Double
  public var lat: Double
  public var lon: Double
  public var altitudeM: Double?
  public var speedMps: Double?
  public var courseDeg: Double?
  public var accuracyM: Double?
  public var altitudeAccuracyM: Double?
  public var roadRmsMps2: Double?

  public init(
    t: Double,
    lat: Double,
    lon: Double,
    altitudeM: Double? = nil,
    speedMps: Double? = nil,
    courseDeg: Double? = nil,
    accuracyM: Double? = nil,
    altitudeAccuracyM: Double? = nil,
    roadRmsMps2: Double? = nil
  ) {
    self.t = t
    self.lat = lat
    self.lon = lon
    self.altitudeM = altitudeM
    self.speedMps = speedMps
    self.courseDeg = courseDeg
    self.accuracyM = accuracyM
    self.altitudeAccuracyM = altitudeAccuracyM
    self.roadRmsMps2 = roadRmsMps2
  }
}

public struct HarshyImuSample: Equatable, Sendable {
  public var t: Double
  public var accel: HarshyVec3
  public var linearAccel: HarshyVec3?
  public var gyro: HarshyVec3?
  public var magnetometer: HarshyVec3?
  public var attitude: HarshyAttitude?
  public var gravity: HarshyVec3?
  public var barometerHpa: Double?

  public init(
    t: Double,
    accel: HarshyVec3,
    linearAccel: HarshyVec3? = nil,
    gyro: HarshyVec3? = nil,
    magnetometer: HarshyVec3? = nil,
    attitude: HarshyAttitude? = nil,
    gravity: HarshyVec3? = nil,
    barometerHpa: Double? = nil
  ) {
    self.t = t
    self.accel = accel
    self.linearAccel = linearAccel
    self.gyro = gyro
    self.magnetometer = magnetometer
    self.attitude = attitude
    self.gravity = gravity
    self.barometerHpa = barometerHpa
  }
}

public struct HarshyDeviceInfo: Equatable, Sendable {
  public var platform: String
  public var model: String?

  public init(platform: String = "ios", model: String? = nil) {
    self.platform = platform
    self.model = model
  }
}

public struct HarshyLiveMetrics: Equatable, Sendable {
  public var t: Double
  public var speedMps: Double?
  public var speedKmh: Double?
  public var headingDeg: Double?
  public var altitudeM: Double?
  public var locationAccuracyM: Double?
  public var longitudinalAccelMps2: Double?
  public var lateralAccelMps2: Double?
  public var verticalAccelMps2: Double?
  public var accelMagnitudeMps2: Double?
  public var gyroMagnitudeRadps: Double?
  public var accelLevel: String
  public var brakeLevel: String
  public var cornerLevel: String
  public var yawRateRadps: Double?
  public var swerveLevel: String
  public var distanceM: Double
  public var durationMs: Double
  public var score: Double
}

public struct HarshyTripMetrics: Equatable, Sendable {
  public var distanceM: Double
  public var durationMs: Double
  public var maxSpeedMps: Double?
  public var avgSpeedMps: Double?
  public var score: Double
  public var eventCounts: [String: Int]
}

public struct HarshyClientState: Equatable, Sendable {
  public var running: Bool
  public var source: String
  public var sessionId: String?
}

public struct HarshyNativeStartOptions: Equatable, Sendable {
  public var imuHz: Int
  public var locationIntervalMs: Int
  public var background: Bool
  public var trigger: String

  public init(
    imuHz: Int = 50,
    locationIntervalMs: Int = 500,
    background: Bool = true,
    trigger: String = "manual"
  ) {
    self.imuHz = imuHz
    self.locationIntervalMs = locationIntervalMs
    self.background = background
    self.trigger = trigger
  }
}

public func harshyParseTripTrigger(_ value: Any?) -> String {
  (value as? String) == "auto" ? "auto" : "manual"
}

/// Sparse watch activity from OS flags. Automotive wins; unknown if none match.
func harshyWatchActivityPick(
  automotive: Bool,
  cycling: Bool,
  running: Bool,
  walking: Bool,
  stationary: Bool
) -> String {
  if automotive { return "automotive" }
  if cycling { return "cycling" }
  if running { return "running" }
  if walking { return "walking" }
  if stationary { return "stationary" }
  return "unknown"
}

public final class HarshyDrivingEvent {
  public let id: String
  public let type: String
  public let t: Double
  public var endT: Double?
  public var peak: Double
  public var severity: Double
  public var level: String
  public var lat: Double?
  public var lon: Double?
  public var speedMps: Double?
  public var overlaps: [String]
  public var impactDirection: String?

  public init(
    id: String,
    type: String,
    t: Double,
    endT: Double? = nil,
    peak: Double,
    severity: Double,
    level: String,
    lat: Double?,
    lon: Double?,
    speedMps: Double?,
    overlaps: [String] = [],
    impactDirection: String? = nil
  ) {
    self.id = id
    self.type = type
    self.t = t
    self.endT = endT
    self.peak = peak
    self.severity = severity
    self.level = level
    self.lat = lat
    self.lon = lon
    self.speedMps = speedMps
    self.overlaps = overlaps
    self.impactDirection = impactDirection
  }
}

public struct HarshySessionExport {
  public var schemaVersion: Int
  public var sessionId: String
  public var startedAt: String
  public var endedAt: String?
  public var config: HarshyDetectorConfig
  public var location: [HarshyLocationSample]
  public var imu: [HarshyImuSample]
  public var events: [HarshyDrivingEvent]
  public var metrics: HarshyTripMetrics
  public var device: HarshyDeviceInfo
  public var trigger: String
}

public let harshyPossibleImpactType = "possible_impact"

public func harshyIsPossibleImpact(_ event: HarshyDrivingEvent) -> Bool {
  event.type == harshyPossibleImpactType
}

public func harshyImpactDirectionLabel(_ direction: String?) -> String {
  switch direction {
  case "front": return "Front"
  case "rear": return "Rear"
  case "rollover": return "Rollover"
  default: return "Direction unknown"
  }
}

let harshyEventHarshAccel = "harsh_accel"
let harshyEventHarshBrake = "harsh_brake"
let harshyEventHarshCorner = "harsh_corner"
let harshyEventSwerve = "swerve"
let harshyEventSpeeding = "speeding"
let harshyEventJerk = "jerk"

func harshyEmptyEventCounts() -> [String: Int] {
  [
    harshyEventHarshAccel: 0,
    harshyEventHarshBrake: 0,
    harshyEventHarshCorner: 0,
    harshyEventSwerve: 0,
    harshyEventSpeeding: 0,
    harshyEventJerk: 0,
    harshyPossibleImpactType: 0,
    harshyPhoneHandheldType: 0,
  ]
}

/// Silent storage thinning while nearly stopped. Matches `@harshy/core` tripBuffer.
enum HarshyTripBuffer {
  static let maxLocationSamples = 20_000
  static let maxImuMinutes = 120
  static let defaultMinSpeedMps = 2.0
  static let idleHysteresisMs: Double = 2500
  static let idleLocationIntervalMs: Double = 8000
  static let idleLocationMinMoveM = 15.0

  static func maxImuSamples(imuHz: Int) -> Int {
    max(1, imuHz) * 60 * maxImuMinutes
  }

  /// Target length after overflow (≈2% slack) so `removeFirst` is amortized.
  static func ringTarget(_ capacity: Int) -> Int {
    if capacity < 50 {
      return capacity
    }
    let slack = max(1, capacity / 50)
    return capacity - slack
  }

  static func trimRing<T>(_ items: inout [T], max: Int) {
    guard items.count > max else { return }
    let target = ringTarget(max)
    items.removeFirst(items.count - target)
  }
}

final class HarshyIdleGate {
  private let minSpeedMps: Double
  private let hysteresisMs: Double
  private let idleLocationIntervalMs: Double
  private let idleLocationMinMoveM: Double

  private var belowSinceMs: Double?
  private var lastIdleLocationAtMs: Double?
  private var lastIdleLat: Double?
  private var lastIdleLon: Double?

  init(
    minSpeedMps: Double = HarshyTripBuffer.defaultMinSpeedMps,
    hysteresisMs: Double = HarshyTripBuffer.idleHysteresisMs,
    idleLocationIntervalMs: Double = HarshyTripBuffer.idleLocationIntervalMs,
    idleLocationMinMoveM: Double = HarshyTripBuffer.idleLocationMinMoveM
  ) {
    self.minSpeedMps = minSpeedMps
    self.hysteresisMs = hysteresisMs
    self.idleLocationIntervalMs = idleLocationIntervalMs
    self.idleLocationMinMoveM = idleLocationMinMoveM
  }

  func reset() {
    belowSinceMs = nil
    lastIdleLocationAtMs = nil
    lastIdleLat = nil
    lastIdleLon = nil
  }

  @discardableResult
  func advance(tMs: Double, speedMps: Double?) -> Bool {
    guard let speed = speedMps, speed.isFinite else {
      return isIdle(nowMs: tMs)
    }
    if speed >= minSpeedMps {
      belowSinceMs = nil
    } else if belowSinceMs == nil {
      belowSinceMs = tMs
    }
    return isIdle(nowMs: tMs)
  }

  func isIdle(nowMs: Double = Date().timeIntervalSince1970 * 1000) -> Bool {
    guard let since = belowSinceMs else { return false }
    return nowMs - since >= hysteresisMs
  }

  func shouldKeepIdleLocation(tMs: Double, lat: Double, lon: Double) -> Bool {
    let moved: Bool
    if let lastLat = lastIdleLat, let lastLon = lastIdleLon {
      moved =
        harshyIdleHaversineM(lat1: lastLat, lon1: lastLon, lat2: lat, lon2: lon)
        >= idleLocationMinMoveM
    } else {
      moved = false
    }
    let due = lastIdleLocationAtMs.map { tMs - $0 >= idleLocationIntervalMs } ?? true
    if !due && !moved {
      return false
    }
    lastIdleLocationAtMs = tMs
    lastIdleLat = lat
    lastIdleLon = lon
    return true
  }
}

private func harshyIdleHaversineM(lat1: Double, lon1: Double, lat2: Double, lon2: Double) -> Double {
  let dLat = (lat2 - lat1) * .pi / 180
  let dLon = (lon2 - lon1) * .pi / 180
  let a =
    sin(dLat / 2) * sin(dLat / 2) +
    cos(lat1 * .pi / 180) * cos(lat2 * .pi / 180) * sin(dLon / 2) * sin(dLon / 2)
  return 2 * 6_371_000 * asin(min(1, sqrt(a)))
}
