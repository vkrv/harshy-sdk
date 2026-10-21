import Foundation

/// Time source for GPS and IMU sample `t` values, in epoch milliseconds.
///
/// Detection works on time differences between samples, so every sample in a trip must be stamped by
/// the same clock. Use `monotonic()` rather than `Date()`: wall-clock corrections during a trip
/// (network time sync, a manual change) would otherwise shift `t` and distort speed and
/// acceleration deltas.
///
/// Used by `HarshyHeadlessTripRecorder` and by hosts that stamp samples themselves; the engine still
/// stamps with the wall clock. Create one clock per trip: the epoch offset is fixed when the clock is
/// created, so a clock kept across trips carries every wall-clock correction made since.
public struct HarshyClock {
  private let read: () -> Int64

  public init(_ read: @escaping () -> Int64) {
    self.read = read
  }

  public func nowMs() -> Int64 { read() }

  /// Epoch milliseconds that advance with the boot clock, including time the device sleeps.
  /// The epoch offset is fixed at creation.
  public static func monotonic() -> HarshyClock {
    monotonic(elapsedRealtimeMs: harshyElapsedRealtimeMs, wallClockMs: harshyWallClockMs)
  }

  static func monotonic(
    elapsedRealtimeMs: @escaping () -> Int64,
    wallClockMs: () -> Int64
  ) -> HarshyClock {
    let epochOffsetMs = wallClockMs() - elapsedRealtimeMs()
    return HarshyClock { epochOffsetMs + elapsedRealtimeMs() }
  }
}

/// `CLOCK_MONOTONIC_RAW` keeps counting while the device sleeps, like Android's `elapsedRealtime`.
private func harshyElapsedRealtimeMs() -> Int64 {
  Int64(clock_gettime_nsec_np(CLOCK_MONOTONIC_RAW) / 1_000_000)
}

private func harshyWallClockMs() -> Int64 {
  Int64(Date().timeIntervalSince1970 * 1000)
}
