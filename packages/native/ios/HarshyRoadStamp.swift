import Foundation

/// Matches `@harshy/core` road window / default settle + min speed.
enum HarshyRoadStamp {
  static let windowMs: Double = 1000
  static let jerkSettleMs: Double = 1500
  static let minSpeedMps: Double = 2.0

  /// World-up linear-accel RMS for one GPS sample. Walks IMU newest-first (O(window)).
  static func roadRmsMps2(
    tMs: Double,
    speedMps: Double?,
    startedAtMs: Double,
    imu: [[String: Any?]]
  ) -> Double? {
    let speed = speedMps ?? 0
    let settleUntil = startedAtMs + jerkSettleMs
    if tMs < settleUntil || speed < minSpeedMps {
      return nil
    }
    let lo = tMs - windowMs
    let hi = tMs
    var sumSq = 0.0
    var n = 0
    for sample in imu.reversed() {
      guard let imuT = sample["t"] as? Double else { continue }
      if imuT > hi { continue }
      if imuT < lo { break }
      if imuT < settleUntil { continue }
      let vertical = verticalLinearAccel(sample)
      sumSq += vertical * vertical
      n += 1
    }
    return n == 0 ? nil : sqrt(sumSq / Double(n))
  }

  static func withRoadRms(
    _ sample: [String: Any?],
    startedAtMs: Double,
    imu: [[String: Any?]]
  ) -> [String: Any?] {
    if sample["roadRmsMps2"] is Double {
      return sample
    }
    guard let tMs = sample["t"] as? Double else { return sample }
    let speed = sample["speedMps"] as? Double
    var next = sample
    next["roadRmsMps2"] = roadRmsMps2(tMs: tMs, speedMps: speed, startedAtMs: startedAtMs, imu: imu)
    return next
  }

  private static func verticalLinearAccel(_ sample: [String: Any?]) -> Double {
    let linear = sample["linearAccel"] as? [String: Any?]
    let accel = linear ?? (sample["accel"] as? [String: Any?]) ?? [:]
    let ax = (accel["x"] as? Double) ?? 0
    let ay = (accel["y"] as? Double) ?? 0
    let az = (accel["z"] as? Double) ?? 0
    if let gravity = sample["gravity"] as? [String: Any?] {
      let gx = (gravity["x"] as? Double) ?? 0
      let gy = (gravity["y"] as? Double) ?? 0
      let gz = (gravity["z"] as? Double) ?? 0
      let mag = sqrt(gx * gx + gy * gy + gz * gz)
      if mag > 0.5 {
        let projected = (ax * gx + ay * gy + az * gz) / mag
        return abs(linear != nil ? projected : projected - mag)
      }
    }
    if let linear {
      return abs((linear["z"] as? Double) ?? 0)
    }
    return abs(az)
  }
}
