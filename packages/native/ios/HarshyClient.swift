import Foundation
import UIKit

/// Host API for native iOS apps. Mirrors JS `createHarshy`.
/// Do not use in the same process as the Expo module — both own the engine listener.
public final class HarshyClient: HarshyEngine.Listener {
  public protocol Listener: AnyObject {
    func harshyClient(_ client: HarshyClient, didUpdate location: HarshyLocationSample)
    func harshyClient(_ client: HarshyClient, didUpdate imu: HarshyImuSample)
    func harshyClient(_ client: HarshyClient, didUpdate metrics: HarshyLiveMetrics)
    func harshyClient(_ client: HarshyClient, didEmit event: HarshyDrivingEvent)
    func harshyClient(_ client: HarshyClient, didChange state: HarshyClientState)
    func harshyClient(_ client: HarshyClient, didFail code: String, message: String)
  }

  public weak var listener: Listener?
  public weak var uploadAdapter: HarshyUploadAdapter?

  private let engine: HarshyEngine
  private let lock = NSLock()
  private var analyzer: HarshyTripAnalyzer?
  private var detectorConfig = HarshyDetectorConfig.default
  private var lastSession: HarshySessionExport?
  private var lastRaw: RawTrip?
  private var running = false
  private var sessionId: String?

  private struct RawTrip {
    var location: [HarshyLocationSample]
    var imu: [HarshyImuSample]
    var startedAtMs: Double
    var endedAtMs: Double
    var sessionId: String
    var device: HarshyDeviceInfo
    var trigger: String
  }

  public init(engine: HarshyEngine = HarshyEngine()) {
    self.engine = engine
    self.engine.listener = self
  }

  public func getState() -> HarshyClientState {
    lock.lock()
    defer { lock.unlock() }
    return HarshyClientState(
      running: running,
      source: running ? "native" : "idle",
      sessionId: sessionId
    )
  }

  public func getDetectorConfig() -> HarshyDetectorConfig {
    lock.lock()
    defer { lock.unlock() }
    return detectorConfig
  }

  @discardableResult
  public func setDetectorConfig(_ config: HarshyDetectorConfig) -> HarshySessionExport? {
    lock.lock()
    detectorConfig = harshyMergeDetectorConfig(config)
    analyzer?.setConfig(detectorConfig)
    lock.unlock()
    return retune(config)
  }

  public func getLastSession() -> HarshySessionExport? { lastSession }

  public func capabilities() -> [String: Any] { engine.capabilities() }

  public func permissionStatus() -> [String: String] { engine.permissionStatus() }

  public func requestPermissions(completion: @escaping ([String: String]) -> Void) {
    engine.requestPermissions(completion: completion)
  }

  public func start(
    native: HarshyNativeStartOptions = HarshyNativeStartOptions(),
    detector: HarshyDetectorConfig? = nil,
    device: HarshyDeviceInfo = HarshyDeviceInfo(platform: "ios", model: UIDevice.current.model)
  ) throws {
    if running {
      _ = stop()
    }
    engine.listener = self
    if attachIfRunning(detector: detector, device: device) {
      return
    }
    let merged = harshyMergeDetectorConfig(detector ?? detectorConfig)
    let id = harshyNewSessionId()
    let startedAtMs = Date().timeIntervalSince1970 * 1000
    let trigger = harshyParseTripTrigger(native.trigger)
    lock.lock()
    detectorConfig = merged
    sessionId = id
    analyzer = HarshyTripAnalyzer(config: merged, sessionId: id, startedAtMs: startedAtMs, device: device, trigger: trigger)
    lastRaw = RawTrip(
      location: [],
      imu: [],
      startedAtMs: startedAtMs,
      endedAtMs: startedAtMs,
      sessionId: id,
      device: device,
      trigger: trigger
    )
    lock.unlock()
    do {
      try engine.start(options: [
        "imuHz": native.imuHz,
        "locationIntervalMs": native.locationIntervalMs,
        "background": native.background,
        "trigger": trigger,
      ])
    } catch {
      lock.lock()
      analyzer = nil
      lastRaw = nil
      running = false
      sessionId = nil
      lock.unlock()
      emitState()
      throw error
    }
    lock.lock()
    running = true
    lock.unlock()
    emitState()
  }

  @discardableResult
  public func recover(
    detector: HarshyDetectorConfig? = nil,
    device: HarshyDeviceInfo = HarshyDeviceInfo(platform: "ios", model: UIDevice.current.model)
  ) -> Bool {
    engine.listener = self
    return attachIfRunning(detector: detector, device: device)
  }

  @discardableResult
  public func stop() -> HarshySessionExport {
    lock.lock()
    let live = analyzer
    let prior = lastRaw
    lock.unlock()
    let snap = engine.stop(includeImu: false)
    let parsedLocation = harshyParseLocationList(snap["location"] as Any?)
    let startedAtMs = harshyAsDouble(snap["startedAtMs"] as Any?) ?? prior?.startedAtMs ?? Date().timeIntervalSince1970 * 1000
    let endedAtMs = harshyAsDouble(snap["endedAtMs"] as Any?) ?? Date().timeIntervalSince1970 * 1000
    let id = (snap["sessionId"] as? String) ?? sessionId ?? prior?.sessionId ?? harshyNewSessionId()
    lock.lock()
    let device = prior?.device ?? HarshyDeviceInfo(platform: "ios", model: UIDevice.current.model)
    let config = detectorConfig
    let session: HarshySessionExport
    if let live, var prior {
      let lastT = prior.location.last?.t ?? -Double.greatestFiniteMagnitude
      for sample in parsedLocation where sample.t > lastT {
        _ = live.pushLocation(sample)
        prior.location.append(sample)
      }
      lastRaw = prior
      trimLastRawLocked()
      session = live.finalize(endedAtMs: endedAtMs)
      lastRaw = RawTrip(
        location: session.location,
        imu: session.imu,
        startedAtMs: prior.startedAtMs,
        endedAtMs: endedAtMs,
        sessionId: session.sessionId,
        device: device,
        trigger: session.trigger
      )
    } else {
      let trigger = harshyParseTripTrigger(snap["trigger"] as Any? ?? prior?.trigger)
      session = harshyAnalyzeTrip(
        location: parsedLocation,
        imu: [],
        sessionId: id,
        startedAtMs: startedAtMs,
        endedAtMs: endedAtMs,
        device: device,
        config: config,
        trigger: trigger
      )
      lastRaw = RawTrip(
        location: session.location,
        imu: session.imu,
        startedAtMs: startedAtMs,
        endedAtMs: endedAtMs,
        sessionId: id,
        device: device,
        trigger: trigger
      )
    }
    running = false
    sessionId = nil
    analyzer = nil
    lock.unlock()
    emitState()
    lastSession = session
    return session
  }

  @discardableResult
  public func retune(_ config: HarshyDetectorConfig? = nil) -> HarshySessionExport? {
    lock.lock()
    guard let raw = lastRaw else {
      let existing = lastSession
      lock.unlock()
      return existing
    }
    let merged = harshyMergeDetectorConfig(config ?? detectorConfig)
    detectorConfig = merged
    let copy = raw
    lock.unlock()
    let session = harshyAnalyzeTrip(
      location: copy.location,
      imu: copy.imu,
      sessionId: copy.sessionId,
      startedAtMs: copy.startedAtMs,
      endedAtMs: copy.endedAtMs,
      device: copy.device,
      config: merged,
      trigger: copy.trigger
    )
    lastSession = session
    return session
  }

  public func upload(_ session: HarshySessionExport? = nil) throws {
    let payload = session ?? lastSession
    guard let payload else {
      throw NSError(domain: "com.harshy.sdk", code: 2, userInfo: [NSLocalizedDescriptionKey: "No session to upload"])
    }
    guard let adapter = uploadAdapter else {
      throw NSError(domain: "com.harshy.sdk", code: 3, userInfo: [NSLocalizedDescriptionKey: "No upload adapter"])
    }
    adapter.upload(sessionJson: try payload.toJSONString())
  }

  public func onLocation(_ sample: [String: Any?]) {
    guard let parsed = harshyParseLocationSample(sample) else { return }
    lock.lock()
    lastRaw?.location.append(parsed)
    trimLastRawLocked()
    let result = analyzer?.pushLocation(parsed)
    lock.unlock()
    listener?.harshyClient(self, didUpdate: parsed)
    emitPush(result)
  }

  public func onImuBatch(_ samples: [[String: Any?]]) {
    for sample in samples {
      guard let parsed = harshyParseImuSample(sample) else { continue }
      lock.lock()
      lastRaw?.imu.append(parsed)
      trimLastRawLocked()
      let result = analyzer?.pushImu(parsed)
      lock.unlock()
      listener?.harshyClient(self, didUpdate: parsed)
      emitPush(result)
    }
  }

  public func onState(_ state: [String: Any?]) {
    emitState()
  }

  public func onError(_ error: [String: Any?]) {
    let code = error["code"] as? String ?? "engine"
    let message = error["message"] as? String ?? "Native engine error"
    listener?.harshyClient(self, didFail: code, message: message)
  }

  private func attachIfRunning(detector: HarshyDetectorConfig?, device: HarshyDeviceInfo) -> Bool {
    if !engine.isRunning() { return false }
    let snap = engine.snapshot(includeImu: true)
    let parsedLocation = harshyParseLocationList(snap["location"] as Any?)
    let parsedImu = harshyParseImuList(snap["imu"] as Any?)
    if (snap["sessionId"] as? String) == nil && parsedLocation.isEmpty { return false }
    let id = (snap["sessionId"] as? String) ?? sessionId ?? harshyNewSessionId()
    let startedAtMs = harshyAsDouble(snap["startedAtMs"] as Any?) ?? Date().timeIntervalSince1970 * 1000
    let merged = harshyMergeDetectorConfig(detector ?? detectorConfig)
    let trigger = harshyParseTripTrigger(snap["trigger"] as Any?)
    let next = HarshyTripAnalyzer(config: merged, sessionId: id, startedAtMs: startedAtMs, device: device, trigger: trigger)
    var lastMetrics: HarshyLiveMetrics?
    for sample in parsedLocation {
      lastMetrics = next.pushLocation(sample).metrics
    }
    for sample in parsedImu {
      _ = next.pushImu(sample)
    }
    lock.lock()
    detectorConfig = merged
    sessionId = id
    analyzer = next
    lastRaw = RawTrip(
      location: parsedLocation,
      imu: parsedImu,
      startedAtMs: startedAtMs,
      endedAtMs: harshyAsDouble(snap["endedAtMs"] as Any?) ?? startedAtMs,
      sessionId: id,
      device: device,
      trigger: trigger
    )
    trimLastRawLocked()
    running = true
    lock.unlock()
    emitState()
    if let lastMetrics {
      listener?.harshyClient(self, didUpdate: lastMetrics)
    }
    return true
  }

  private func trimLastRawLocked() {
    guard var raw = lastRaw else { return }
    HarshyTripBuffer.trimRing(&raw.location, max: HarshyTripBuffer.maxLocationSamples)
    HarshyTripBuffer.trimRing(&raw.imu, max: HarshyTripBuffer.maxImuSamples(imuHz: 50))
    lastRaw = raw
  }

  private func emitPush(_ result: HarshyAnalyzerPush?) {
    guard let result else { return }
    listener?.harshyClient(self, didUpdate: result.metrics)
    for event in result.newEvents {
      listener?.harshyClient(self, didEmit: event)
    }
  }

  private func emitState() {
    listener?.harshyClient(self, didChange: getState())
  }
}

public extension HarshyClient.Listener {
  func harshyClient(_ client: HarshyClient, didUpdate location: HarshyLocationSample) {}
  func harshyClient(_ client: HarshyClient, didUpdate imu: HarshyImuSample) {}
  func harshyClient(_ client: HarshyClient, didUpdate metrics: HarshyLiveMetrics) {}
  func harshyClient(_ client: HarshyClient, didEmit event: HarshyDrivingEvent) {}
  func harshyClient(_ client: HarshyClient, didChange state: HarshyClientState) {}
  func harshyClient(_ client: HarshyClient, didFail code: String, message: String) {}
}
