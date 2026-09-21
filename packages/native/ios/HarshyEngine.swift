import CoreLocation
import CoreMotion
import Foundation

public final class HarshyEngine: NSObject, CLLocationManagerDelegate {
  public protocol Listener: AnyObject {
    func onLocation(_ sample: [String: Any?])
    func onImuBatch(_ samples: [[String: Any?]])
    func onState(_ state: [String: Any?])
    func onError(_ error: [String: Any?])
    func onWatchFix(_ sample: [String: Any?])
  }

  public weak var listener: Listener?

  private let locationManager = CLLocationManager()
  private let watchManager = CLLocationManager()
  private let motion = CMMotionManager()
  private let altimeter = CMAltimeter()
  private let motionQueue = OperationQueue()
  private let syncQueue = DispatchQueue(label: "com.harshy.engine")

  private var running = false
  private var previewing = false
  private var sessionId: String?
  private var startedAtMs: Double = 0
  private var imuHz = 25
  private var locationIntervalMs = 500
  private var background = true
  private var tripTrigger = "manual"

  private var locationSamples: [[String: Any?]] = []
  private var imuSamples: [[String: Any?]] = []
  private var imuBatch: [[String: Any?]] = []
  private var lastPressure: Double?
  private var altimeterActive = false
  private var permissionCompletions: [([String: String]) -> Void] = []
  private var motionAuthProbe: CMMotionActivityManager?
  private let askedAlwaysKey = "com.harshy.engine.didRequestAlways"
  private let idleGate = HarshyIdleGate()
  private var vehicleIdle = false
  private var watching = false
  private var watchActivityManager: CMMotionActivityManager?
  private var lastWatchActivity = "unknown"

  public override init() {
    super.init()
    motionQueue.maxConcurrentOperationCount = 1
    locationManager.delegate = self
    locationManager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
    locationManager.distanceFilter = kCLDistanceFilterNone
    locationManager.activityType = .automotiveNavigation
    locationManager.pausesLocationUpdatesAutomatically = false
    watchManager.delegate = self
    watchManager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    watchManager.distanceFilter = 25
    watchManager.activityType = .automotiveNavigation
    watchManager.pausesLocationUpdatesAutomatically = false
    watchManager.allowsBackgroundLocationUpdates = false
    watchManager.showsBackgroundLocationIndicator = false
  }

  public func capabilities() -> [String: Any] {
    [
      "location": CLLocationManager.locationServicesEnabled(),
      "accelerometer": motion.isAccelerometerAvailable,
      "linearAcceleration": motion.isDeviceMotionAvailable,
      "gyroscope": motion.isGyroAvailable,
      "magnetometer": motion.isMagnetometerAvailable,
      "barometer": CMAltimeter.isRelativeAltitudeAvailable(),
      "attitude": motion.isDeviceMotionAvailable,
      "backgroundLocation": true,
    ]
  }

  public func permissionStatus() -> [String: String] {
    [
      "location": locationPermissionLabel(),
      "backgroundLocation": backgroundLocationLabel(),
      "motion": motionPermissionLabel(),
      "notifications": "granted",
    ]
  }

  public func requestPermissions() -> [String: String] {
    requestPermissions { _ in }
    return permissionStatus()
  }

  public func requestPermissions(completion: @escaping ([String: String]) -> Void) {
    requestWhenInUseIfNeeded { [weak self] in
      self?.requestAlwaysIfNeeded {
        self?.requestMotionIfNeeded {
          completion(self?.permissionStatus() ?? [:])
        }
      }
    }
  }

  public func start(options: [String: Any]) throws {
    disarmWatch()
    if running {
      startForegroundSensors()
      listener?.onState([
        "running": true,
        "sessionId": sessionId,
        "startedAtMs": startedAtMs,
        "source": "native",
      ])
      return
    }

    imuHz = clampInt(options["imuHz"], fallback: 25, min: 5, max: 100)
    locationIntervalMs = clampInt(options["locationIntervalMs"], fallback: 500, min: 200, max: 5_000)
    background = (options["background"] as? Bool) ?? true
    tripTrigger = harshyParseTripTrigger(options["trigger"])

    let status = locationManager.authorizationStatus
    guard status == .authorizedAlways || status == .authorizedWhenInUse else {
      throw NSError(
        domain: "com.harshy.engine",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Location permission is required"]
      )
    }

    sessionId = UUID().uuidString
    startedAtMs = Date().timeIntervalSince1970 * 1000
    syncQueue.sync {
      locationSamples.removeAll()
      imuSamples.removeAll()
      imuBatch.removeAll()
      idleGate.reset()
      vehicleIdle = false
    }
    running = true
    previewing = false

    let always = status == .authorizedAlways
    if background && always {
      locationManager.allowsBackgroundLocationUpdates = true
      locationManager.showsBackgroundLocationIndicator = true
    }
    startForegroundSensors()

    listener?.onState([
      "running": true,
      "sessionId": sessionId,
      "startedAtMs": startedAtMs,
      "source": "native",
    ])
  }

  /// Foreground GPS+IMU for a live readout. Not a trip: no `running`, no background
  /// indicator, no sample rings. Does not disarm the motion watch.
  public func startPreview(options: [String: Any] = [:]) throws {
    if running || previewing {
      return
    }
    imuHz = clampInt(options["imuHz"], fallback: 50, min: 5, max: 100)
    locationIntervalMs = clampInt(options["locationIntervalMs"], fallback: 500, min: 200, max: 5_000)

    let status = locationManager.authorizationStatus
    guard status == .authorizedAlways || status == .authorizedWhenInUse else {
      throw NSError(
        domain: "com.harshy.engine",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Location permission is required"]
      )
    }

    previewing = true
    locationManager.allowsBackgroundLocationUpdates = false
    locationManager.showsBackgroundLocationIndicator = false
    startForegroundSensors()
  }

  /// Stop a foreground sensor readout. No-op during a trip. Leaves an armed watch in place.
  public func stopPreview() {
    guard previewing else {
      return
    }
    previewing = false
    if running {
      return
    }
    stopForegroundSensors()
  }

  public func isRunning() -> Bool {
    running
  }

  public func isPreviewing() -> Bool {
    previewing
  }

  private func startForegroundSensors() {
    locationManager.startUpdatingLocation()
    if motion.isDeviceMotionAvailable, !motion.isDeviceMotionActive {
      motion.deviceMotionUpdateInterval = 1.0 / Double(imuHz)
      motion.startDeviceMotionUpdates(using: .xArbitraryZVertical, to: motionQueue) { [weak self] data, error in
        guard let self, self.running || self.previewing else { return }
        if let error {
          self.listener?.onError(["code": "motion", "message": error.localizedDescription])
          return
        }
        guard let data else { return }
        self.captureMotion(data)
      }
    } else if motion.isDeviceMotionActive {
      motion.deviceMotionUpdateInterval = 1.0 / Double(imuHz)
    }
    if CMAltimeter.isRelativeAltitudeAvailable(), !altimeterActive {
      altimeterActive = true
      altimeter.startRelativeAltitudeUpdates(to: motionQueue) { [weak self] data, _ in
        guard let self, self.running || self.previewing else { return }
        if let pressure = data?.pressure {
          self.lastPressure = pressure.doubleValue
        }
      }
    }
  }

  private func stopForegroundSensors() {
    locationManager.stopUpdatingLocation()
    locationManager.allowsBackgroundLocationUpdates = false
    locationManager.showsBackgroundLocationIndicator = false
    motion.stopDeviceMotionUpdates()
    if altimeterActive {
      altimeter.stopRelativeAltitudeUpdates()
      altimeterActive = false
    }
    flushImuBatch()
  }

  public func stop(includeImu: Bool = false) -> [String: Any?] {
    running = false
    previewing = false
    stopForegroundSensors()

    let endedAtMs = Date().timeIntervalSince1970 * 1000
    let snapshot = snapshot(endedAtMs: endedAtMs, includeImu: includeImu)
    listener?.onState([
      "running": false,
      "sessionId": sessionId,
      "startedAtMs": startedAtMs,
      "endedAtMs": endedAtMs,
      "source": "native",
    ])
    return snapshot
  }

  /// Sparse OS watch for automatic trips. No IMU, no background trip indicator.
  /// No-op while a trip is running. Throws if Always location is missing.
  public func armWatch() throws {
    if running {
      return
    }
    if watching {
      return
    }
    guard locationManager.authorizationStatus == .authorizedAlways else {
      throw NSError(
        domain: "com.harshy.engine",
        code: 2,
        userInfo: [NSLocalizedDescriptionKey: "Background location is required for automatic trips"]
      )
    }
    watching = true
    lastWatchActivity = "unknown"
    watchManager.startMonitoringSignificantLocationChanges()
    watchManager.startUpdatingLocation()
    startWatchActivity()
  }

  public func disarmWatch() {
    guard watching else {
      return
    }
    watching = false
    lastWatchActivity = "unknown"
    watchManager.stopUpdatingLocation()
    watchManager.stopMonitoringSignificantLocationChanges()
    stopWatchActivity()
  }

  public func isWatching() -> Bool {
    watching
  }

  public func snapshot(
    endedAtMs: Double = Date().timeIntervalSince1970 * 1000,
    includeImu: Bool = true
  ) -> [String: Any?] {
    var location: [[String: Any?]] = []
    var imu: [[String: Any?]] = []
    syncQueue.sync {
      location = locationSamples
      if includeImu {
        imu = imuSamples
      }
    }
    return [
      "sessionId": sessionId,
      "startedAtMs": startedAtMs,
      "endedAtMs": endedAtMs,
      "location": location,
      "imu": imu,
      "trigger": tripTrigger,
      "capabilities": capabilities(),
    ]
  }

  public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    flushPermissionCompletions()
  }

  public func locationManager(_ manager: CLLocationManager, didChangeAuthorization status: CLAuthorizationStatus) {
    flushPermissionCompletions()
  }

  public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    if manager === watchManager {
      handleWatchLocations(locations)
      return
    }
    guard running || previewing, let location = locations.last else { return }
    if previewing && !running {
      listener?.onLocation(location.toSampleMap())
      return
    }
    var sample = location.toSampleMap()
    let tMs = (sample["t"] as? Double) ?? (Date().timeIntervalSince1970 * 1000)
    let speed = sample["speedMps"] as? Double
    var emit = true
    syncQueue.sync {
      let idle = idleGate.advance(tMs: tMs, speedMps: speed)
      vehicleIdle = idle
      if idle {
        let lat = sample["lat"] as? Double ?? 0
        let lon = sample["lon"] as? Double ?? 0
        if !idleGate.shouldKeepIdleLocation(tMs: tMs, lat: lat, lon: lon) {
          emit = false
          return
        }
      }
      // Stamp road on-device so Expo stop (no IMU bridge) still keeps History Road mode.
      sample = HarshyRoadStamp.withRoadRms(sample, startedAtMs: startedAtMs, imu: imuSamples)
      locationSamples.append(sample)
      HarshyTripBuffer.trimRing(&locationSamples, max: HarshyTripBuffer.maxLocationSamples)
    }
    if emit {
      listener?.onLocation(sample)
    }
  }

  public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    if manager === watchManager {
      listener?.onError(["code": "watch", "message": error.localizedDescription])
      return
    }
    listener?.onError(["code": "location", "message": error.localizedDescription])
  }

  private func startWatchActivity() {
    guard CMMotionActivityManager.isActivityAvailable() else {
      return
    }
    let manager = CMMotionActivityManager()
    watchActivityManager = manager
    manager.startActivityUpdates(to: motionQueue) { [weak self] activity in
      guard let self, self.watching, !self.running else { return }
      self.lastWatchActivity = harshyWatchActivityLabel(activity)
    }
  }

  private func stopWatchActivity() {
    watchActivityManager?.stopActivityUpdates()
    watchActivityManager = nil
  }

  private func handleWatchLocations(_ locations: [CLLocation]) {
    guard watching, !running, let location = locations.last else {
      return
    }
    // Publish immediately. Waiting on queryActivityStarting delayed every
    // watch fix (and can stall in the background), which blocked auto-start.
    publishWatchFix(location, activity: lastWatchActivity)
  }

  private func publishWatchFix(_ location: CLLocation, activity: String) {
    guard watching, !running else {
      return
    }
    var sample = location.toSampleMap()
    let speed: Double? = location.speed >= 0 ? location.speed : nil
    sample["activity"] = harshyWatchKinematicActivity(activity, speedMps: speed)
    listener?.onWatchFix(sample)
  }

  private func flushPermissionCompletions() {
    let completions = permissionCompletions
    permissionCompletions.removeAll()
    guard !completions.isEmpty else {
      return
    }
    let status = permissionStatus()
    completions.forEach { $0(status) }
  }

  private func locationPermissionLabel() -> String {
    switch locationManager.authorizationStatus {
    case .authorizedAlways, .authorizedWhenInUse:
      return "granted"
    case .notDetermined:
      return "undetermined"
    default:
      return "denied"
    }
  }

  private func backgroundLocationLabel() -> String {
    switch locationManager.authorizationStatus {
    case .authorizedAlways:
      return "granted"
    case .notDetermined:
      return "undetermined"
    default:
      return "denied"
    }
  }

  private func motionPermissionLabel() -> String {
    switch CMMotionActivityManager.authorizationStatus() {
    case .authorized:
      return "granted"
    case .denied, .restricted:
      return "denied"
    case .notDetermined:
      return CMMotionActivityManager.isActivityAvailable() ? "undetermined" : "granted"
    @unknown default:
      return "denied"
    }
  }

  private func requestWhenInUseIfNeeded(done: @escaping () -> Void) {
    if locationManager.authorizationStatus != .notDetermined {
      done()
      return
    }
    permissionCompletions.append { _ in done() }
    locationManager.requestWhenInUseAuthorization()
  }

  private func requestAlwaysIfNeeded(done: @escaping () -> Void) {
    guard locationManager.authorizationStatus == .authorizedWhenInUse else {
      done()
      return
    }
    if UserDefaults.standard.bool(forKey: askedAlwaysKey) {
      done()
      return
    }
    UserDefaults.standard.set(true, forKey: askedAlwaysKey)
    permissionCompletions.append { _ in done() }
    locationManager.requestAlwaysAuthorization()
  }

  private func requestMotionIfNeeded(done: @escaping () -> Void) {
    guard CMMotionActivityManager.isActivityAvailable(),
          CMMotionActivityManager.authorizationStatus() == .notDetermined
    else {
      done()
      return
    }
    let probe = CMMotionActivityManager()
    motionAuthProbe = probe
    probe.queryActivityStarting(from: Date().addingTimeInterval(-1), to: Date(), to: .main) { [weak self] _, _ in
      self?.motionAuthProbe = nil
      done()
    }
  }

  private func captureMotion(_ data: CMDeviceMotion) {
    let trip = running
    if trip {
      var skip = false
      syncQueue.sync {
        skip = vehicleIdle || idleGate.isIdle()
      }
      if skip {
        return
      }
    }
    let g = 9.80665
    let sample: [String: Any?] = [
      "t": Date().timeIntervalSince1970 * 1000,
      "accel": [
        "x": (data.userAcceleration.x + data.gravity.x) * g,
        "y": (data.userAcceleration.y + data.gravity.y) * g,
        "z": (data.userAcceleration.z + data.gravity.z) * g,
      ],
      "linearAccel": [
        "x": data.userAcceleration.x * g,
        "y": data.userAcceleration.y * g,
        "z": data.userAcceleration.z * g,
      ],
      "gyro": [
        "x": data.rotationRate.x,
        "y": data.rotationRate.y,
        "z": data.rotationRate.z,
      ],
      "magnetometer": [
        "x": data.magneticField.field.x,
        "y": data.magneticField.field.y,
        "z": data.magneticField.field.z,
      ],
      "attitude": [
        "pitch": data.attitude.pitch,
        "roll": data.attitude.roll,
        "yaw": data.attitude.yaw,
      ],
      "gravity": [
        "x": data.gravity.x * g,
        "y": data.gravity.y * g,
        "z": data.gravity.z * g,
      ],
      "barometerHpa": lastPressure,
    ]

    var ready: [[String: Any?]] = []
    syncQueue.sync {
      if trip {
        imuSamples.append(sample)
        HarshyTripBuffer.trimRing(&imuSamples, max: HarshyTripBuffer.maxImuSamples(imuHz: imuHz))
      }
      imuBatch.append(sample)
      if imuBatch.count >= Swift.max(2, imuHz / 5) {
        ready = imuBatch
        imuBatch.removeAll()
      }
    }
    if !ready.isEmpty {
      listener?.onImuBatch(ready)
    }
  }

  private func flushImuBatch() {
    var ready: [[String: Any?]] = []
    syncQueue.sync {
      ready = imuBatch
      imuBatch.removeAll()
    }
    if !ready.isEmpty {
      listener?.onImuBatch(ready)
    }
  }
}

extension HarshyEngine.Listener {
  public func onWatchFix(_ sample: [String: Any?]) {}
}

/// Motion-activity label for sparse watch fixes. Ranking lives in `harshyWatchActivityPick`.
private func harshyWatchActivityLabel(_ activity: CMMotionActivity?) -> String {
  guard let activity else {
    return "unknown"
  }
  return harshyWatchActivityPick(
    automotive: activity.automotive,
    cycling: activity.cycling,
    running: activity.running,
    walking: activity.walking,
    stationary: activity.stationary
  )
}

private func harshyWatchActivityLabel(_ activities: [CMMotionActivity]?) -> String {
  guard let activities, !activities.isEmpty else {
    return "unknown"
  }
  let usable = activities.filter { $0.confidence != .low }
  let pool = usable.isEmpty ? activities : usable
  if pool.contains(where: { $0.automotive }) { return "automotive" }
  if pool.contains(where: { $0.cycling }) { return "cycling" }
  if pool.contains(where: { $0.running }) { return "running" }
  if pool.contains(where: { $0.walking }) { return "walking" }
  if pool.contains(where: { $0.stationary }) { return "stationary" }
  return "unknown"
}

private func clampInt(_ value: Any?, fallback: Int, min: Int, max: Int) -> Int {
  let number = (value as? NSNumber)?.intValue ?? fallback
  return Swift.min(max, Swift.max(min, number))
}

private extension CLLocation {
  func toSampleMap() -> [String: Any?] {
    // Wall clock — must match IMU timestamps so road RMS windows align.
    [
      "t": Date().timeIntervalSince1970 * 1000,
      "lat": coordinate.latitude,
      "lon": coordinate.longitude,
      "altitudeM": altitude,
      "speedMps": speed >= 0 ? speed : nil,
      "courseDeg": course >= 0 ? course : nil,
      "accuracyM": horizontalAccuracy >= 0 ? horizontalAccuracy : nil,
      "altitudeAccuracyM": verticalAccuracy >= 0 ? verticalAccuracy : nil,
    ]
  }
}
