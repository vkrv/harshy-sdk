import Foundation

/// One device-motion reading in Core Motion units.
public struct HarshyMotionReading: Equatable {
  /// Seconds between the sensor producing the reading and the source delivering it.
  public var ageSeconds: Double
  /// User acceleration in g.
  public var userAccelerationG: HarshyVec3
  /// Gravity in g.
  public var gravityG: HarshyVec3
  /// Rotation rate in rad/s.
  public var rotationRateRadps: HarshyVec3

  public init(ageSeconds: Double, userAccelerationG: HarshyVec3, gravityG: HarshyVec3, rotationRateRadps: HarshyVec3) {
    self.ageSeconds = ageSeconds
    self.userAccelerationG = userAccelerationG
    self.gravityG = gravityG
    self.rotationRateRadps = rotationRateRadps
  }
}

/// Where `HarshyHeadlessTripRecorder` gets device motion. iOS hosts use the default,
/// `HarshyCoreMotionSource`; the seam exists so the recorder's queue and lifecycle logic runs under
/// `swift test` with a fake.
public protocol HarshyMotionSource: AnyObject {
  var isAvailable: Bool { get }
  /// Starts delivering readings to `handler` on `queue`, about every `intervalSeconds`. `handler` gets
  /// an error, and no reading, when the source fails.
  func start(intervalSeconds: Double, queue: OperationQueue, handler: @escaping (HarshyMotionReading?, Error?) -> Void)
  func stop()
}

/// The Core Motion source on iOS, and none elsewhere (Core Motion's device motion is iOS-only).
public func harshySystemMotionSource() -> HarshyMotionSource? {
  #if os(iOS)
  return HarshyCoreMotionSource()
  #else
  return nil
  #endif
}
