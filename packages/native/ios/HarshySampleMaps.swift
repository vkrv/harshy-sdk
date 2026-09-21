import Foundation

func harshyAsDouble(_ value: Any?) -> Double? {
  if value == nil || value is NSNull { return nil }
  if let number = value as? Double { return number }
  if let number = value as? Float { return Double(number) }
  if let number = value as? Int { return Double(number) }
  if let number = value as? Int64 { return Double(number) }
  if let number = value as? NSNumber { return number.doubleValue }
  if let text = value as? String { return Double(text) }
  return nil
}

func harshyStringKeyed(_ value: Any?) -> [String: Any]? {
  if value == nil || value is NSNull { return nil }
  if let map = value as? [String: Any] { return map }
  if let map = value as? [String: Double] {
    return map.mapValues { $0 as Any }
  }
  if let map = value as? [String: Any?] {
    var out: [String: Any] = [:]
    for (key, nested) in map {
      if let nested { out[key] = nested }
    }
    return out
  }
  if let map = value as? NSDictionary {
    var out: [String: Any] = [:]
    for (key, nested) in map {
      if let key = key as? String { out[key] = nested }
    }
    return out
  }
  return nil
}

func harshyParseVec(_ value: Any?) -> HarshyVec3? {
  guard let map = harshyStringKeyed(value), let x = harshyAsDouble(map["x"]) else {
    return nil
  }
  return HarshyVec3(x: x, y: harshyAsDouble(map["y"]) ?? 0, z: harshyAsDouble(map["z"]) ?? 0)
}

func harshyParseAttitude(_ value: Any?) -> HarshyAttitude? {
  guard let map = harshyStringKeyed(value), let pitch = harshyAsDouble(map["pitch"]) else {
    return nil
  }
  return HarshyAttitude(
    pitch: pitch,
    roll: harshyAsDouble(map["roll"]) ?? 0,
    yaw: harshyAsDouble(map["yaw"]) ?? 0
  )
}

public func harshyParseLocationSample(_ raw: [String: Any?]) -> HarshyLocationSample? {
  harshyParseLocationSampleValue(raw)
}

func harshyParseLocationSampleValue(_ value: Any?) -> HarshyLocationSample? {
  guard let raw = harshyStringKeyed(value),
        let t = harshyAsDouble(raw["t"]),
        let lat = harshyAsDouble(raw["lat"]),
        let lon = harshyAsDouble(raw["lon"])
  else { return nil }
  return HarshyLocationSample(
    t: t,
    lat: lat,
    lon: lon,
    altitudeM: harshyAsDouble(raw["altitudeM"]),
    speedMps: harshyAsDouble(raw["speedMps"]),
    courseDeg: harshyAsDouble(raw["courseDeg"]),
    accuracyM: harshyAsDouble(raw["accuracyM"]),
    altitudeAccuracyM: harshyAsDouble(raw["altitudeAccuracyM"]),
    roadRmsMps2: harshyAsDouble(raw["roadRmsMps2"])
  )
}

public func harshyParseImuSample(_ raw: [String: Any?]) -> HarshyImuSample? {
  harshyParseImuSampleValue(raw)
}

func harshyParseImuSampleValue(_ value: Any?) -> HarshyImuSample? {
  guard let raw = harshyStringKeyed(value),
        let t = harshyAsDouble(raw["t"]),
        let accel = harshyParseVec(raw["accel"])
  else { return nil }
  return HarshyImuSample(
    t: t,
    accel: accel,
    linearAccel: harshyParseVec(raw["linearAccel"]),
    gyro: harshyParseVec(raw["gyro"]),
    magnetometer: harshyParseVec(raw["magnetometer"]),
    attitude: harshyParseAttitude(raw["attitude"]),
    gravity: harshyParseVec(raw["gravity"]),
    barometerHpa: harshyAsDouble(raw["barometerHpa"])
  )
}

func harshyParseLocationList(_ value: Any?) -> [HarshyLocationSample] {
  if let list = value as? [Any] {
    return list.compactMap(harshyParseLocationSampleValue)
  }
  if let list = value as? NSArray {
    return list.compactMap { harshyParseLocationSampleValue($0) }
  }
  return []
}

func harshyParseImuList(_ value: Any?) -> [HarshyImuSample] {
  if let list = value as? [Any] {
    return list.compactMap(harshyParseImuSampleValue)
  }
  if let list = value as? NSArray {
    return list.compactMap { harshyParseImuSampleValue($0) }
  }
  return []
}
