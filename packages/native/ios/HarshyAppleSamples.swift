import CoreLocation
import Foundation

private let harshyStandardGravityMps2 = 9.80665

extension CLLocation {
  /// GPS sample from a platform location. `tMs` is the capture time from the trip's `HarshyClock`,
  /// not `timestamp`: GNSS time can drift from the IMU clock and break road RMS alignment.
  public func harshyLocationSample(tMs: Int64) -> HarshyLocationSample {
    HarshyLocationSample(
      t: Double(tMs),
      lat: coordinate.latitude,
      lon: coordinate.longitude,
      altitudeM: altitude,
      speedMps: speed >= 0 ? speed : nil,
      courseDeg: course >= 0 ? course : nil,
      accuracyM: horizontalAccuracy >= 0 ? horizontalAccuracy : nil,
      altitudeAccuracyM: verticalAccuracy >= 0 ? verticalAccuracy : nil
    )
  }
}

/// IMU sample from one Core Motion device-motion reading. Pass the reading's values in Core Motion
/// units: `userAccelerationG` and `gravityG` in g, `rotationRateRadps` in rad/s. Accel is user
/// acceleration plus gravity in m/s², as the engine stamps it; the detector reads accel,
/// linearAccel, gyro and gravity.
public func harshyImuSample(
  tMs: Int64,
  userAccelerationG: HarshyVec3,
  gravityG: HarshyVec3,
  rotationRateRadps: HarshyVec3
) -> HarshyImuSample {
  let g = harshyStandardGravityMps2
  return HarshyImuSample(
    t: Double(tMs),
    accel: HarshyVec3(
      x: (userAccelerationG.x + gravityG.x) * g,
      y: (userAccelerationG.y + gravityG.y) * g,
      z: (userAccelerationG.z + gravityG.z) * g
    ),
    linearAccel: HarshyVec3(x: userAccelerationG.x * g, y: userAccelerationG.y * g, z: userAccelerationG.z * g),
    gyro: rotationRateRadps,
    gravity: HarshyVec3(x: gravityG.x * g, y: gravityG.y * g, z: gravityG.z * g)
  )
}
