import CoreLocation
import Foundation

private let harshyStandardGravityMps2 = 9.80665

extension CLLocation {
  /// GPS sample from a platform location. `tMs` is the capture time on the trip's `HarshyClock`, for
  /// example from `harshyCaptureMs`. It is not `timestamp` itself: GNSS time can drift from the IMU
  /// clock and break road RMS alignment.
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

/// When a reading was captured, on the trip clock: `nowMs` minus the reading's age.
///
/// Stamping at the callback would give every fix of one `didUpdateLocations` batch the same `t`, and
/// would add queue delay to every IMU sample. The age is a difference of two readings of one time
/// base (wall clock for a `CLLocation`, system uptime for Core Motion), so it holds when the trip
/// clock and the sensor clock disagree about the absolute time. A negative or non-finite age counts
/// as zero. An age above `maxAgeSeconds` means the sensor clock cannot be trusted (a wall clock set
/// by hand, a sleeping device), so the reading is stamped at `nowMs` instead of far in the past.
public func harshyCaptureMs(nowMs: Int64, ageSeconds: Double, maxAgeSeconds: Double) -> Int64 {
  guard ageSeconds.isFinite, ageSeconds > 0, ageSeconds <= maxAgeSeconds else { return nowMs }
  return nowMs - Int64((ageSeconds * 1000).rounded())
}
