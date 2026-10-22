#if os(iOS)
import CoreMotion
import Foundation

/// Core Motion device-motion updates (accel, linear accel, gyro and gravity). It reads no
/// magnetometer, attitude or barometer, and it never asks for the Motion & Fitness permission.
///
/// It owns a `CMMotionManager`. Apple recommends one per app, so a host that already runs one, or
/// runs `HarshyEngine`, may see lower rates on one of them.
public final class HarshyCoreMotionSource: HarshyMotionSource {
  private let manager = CMMotionManager()

  public init() {}

  public var isAvailable: Bool { manager.isDeviceMotionAvailable }

  public func start(intervalSeconds: Double, queue: OperationQueue, handler: @escaping (HarshyMotionReading?, Error?) -> Void) {
    manager.deviceMotionUpdateInterval = intervalSeconds
    manager.startDeviceMotionUpdates(using: .xArbitraryZVertical, to: queue) { data, error in
      if let error {
        handler(nil, error)
        return
      }
      guard let data else { return }
      // `CMLogItem.timestamp` counts seconds since boot on the same base as `systemUptime`.
      handler(
        HarshyMotionReading(
          ageSeconds: ProcessInfo.processInfo.systemUptime - data.timestamp,
          userAccelerationG: HarshyVec3(x: data.userAcceleration.x, y: data.userAcceleration.y, z: data.userAcceleration.z),
          gravityG: HarshyVec3(x: data.gravity.x, y: data.gravity.y, z: data.gravity.z),
          rotationRateRadps: HarshyVec3(x: data.rotationRate.x, y: data.rotationRate.y, z: data.rotationRate.z)
        ),
        nil
      )
    }
  }

  public func stop() {
    manager.stopDeviceMotionUpdates()
  }
}
#endif
