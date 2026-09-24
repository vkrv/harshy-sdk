import ExpoModulesCore

public class HarshyNativeModule: Module, HarshyEngine.Listener {
  private let engine = HarshyEngine()

  public func definition() -> ModuleDefinition {
    Name("HarshyNative")

    Events("onLocation", "onImuBatch", "onState", "onError", "onWatchFix")

    OnCreate {
      self.engine.listener = self
    }

    AsyncFunction("getCapabilities") {
      return self.engine.capabilities()
    }

    AsyncFunction("getPermissionStatus") {
      return self.engine.permissionStatus()
    }

    AsyncFunction("requestPermissions") { (promise: Promise) in
      self.engine.requestPermissions { status in
        promise.resolve(status)
      }
    }

    AsyncFunction("requestPermission") { (kind: String, promise: Promise) in
      self.engine.requestPermission(kind: kind) { status in
        promise.resolve(status)
      }
    }

    AsyncFunction("requestBackgroundLocation") { (promise: Promise) in
      self.engine.requestBackgroundLocation { status in
        promise.resolve(status)
      }
    }

    AsyncFunction("start") { (options: [String: Any]) in
      try self.engine.start(options: options)
    }

    AsyncFunction("startPreview") { (options: [String: Any]) in
      try self.engine.startPreview(options: options)
    }

    AsyncFunction("stopPreview") {
      self.engine.stopPreview()
    }

    AsyncFunction("stop") {
      // Live JS analyzer already holds a capped ring; skip bridging full IMU.
      return self.engine.stop(includeImu: false)
    }

    AsyncFunction("getSnapshot") {
      // Recover replays GPS into the analyzer; IMU stays on the native ring.
      return self.engine.snapshot(includeImu: false)
    }

    AsyncFunction("isRunning") {
      return self.engine.isRunning()
    }

    AsyncFunction("updateTripLiveDisplay") { (_: [String: Any]) in
      // iOS Live Activity is driven from JS (expo-widgets). Android updates the FGS notice.
    }

    AsyncFunction("clearTripLiveDisplay") {
      // no-op on iOS
    }

    AsyncFunction("armWatch") {
      try self.engine.armWatch()
    }

    AsyncFunction("disarmWatch") {
      self.engine.disarmWatch()
    }
  }

  public func onLocation(_ sample: [String: Any?]) {
    sendEvent("onLocation", eventPayload(sample))
  }

  public func onImuBatch(_ samples: [[String: Any?]]) {
    sendEvent("onImuBatch", ["samples": samples.map { eventPayload($0) }])
  }

  public func onState(_ state: [String: Any?]) {
    sendEvent("onState", eventPayload(state))
  }

  public func onError(_ error: [String: Any?]) {
    sendEvent("onError", eventPayload(error))
  }

  public func onWatchFix(_ sample: [String: Any?]) {
    sendEvent("onWatchFix", eventPayload(sample))
  }

  private func eventPayload(_ sample: [String: Any?]) -> [String: Any] {
    Dictionary(uniqueKeysWithValues: sample.map { key, value in
      (key, value ?? NSNull())
    })
  }
}
