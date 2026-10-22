import Foundation

/// Thins a location stream to roughly one fix per `intervalMs`. Fixes arriving up to 10% early
/// still pass, so a 500 ms provider stream throttled to 1 s keeps every second fix.
final class HarshyLocationThrottle {
  private static let minGapRatio = 0.9

  private let minGapMs: Double
  private var lastAcceptedMs: Int64?

  init(intervalMs: Int) {
    minGapMs = Double(intervalMs) * Self.minGapRatio
  }

  func accept(_ tMs: Int64) -> Bool {
    if let last = lastAcceptedMs, Double(tMs - last) < minGapMs {
      return false
    }
    lastAcceptedMs = tMs
    return true
  }
}
