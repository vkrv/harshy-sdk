import XCTest
@testable import HarshyMath

final class HarshyIdleGateTests: XCTestCase {
  func testMaxImuSamplesMatchesCoreFormula() {
    XCTAssertEqual(HarshyTripBuffer.maxImuSamples(imuHz: 50), 50 * 60 * 120)
    XCTAssertEqual(HarshyTripBuffer.maxImuSamples(imuHz: 25), 25 * 60 * 120)
    XCTAssertEqual(HarshyTripBuffer.maxImuSamples(imuHz: 0), 1 * 60 * 120)
  }

  func testRingTargetAppliesTwoPercentSlack() {
    XCTAssertEqual(HarshyTripBuffer.ringTarget(3), 3)
    XCTAssertEqual(HarshyTripBuffer.ringTarget(100), 98)
    XCTAssertEqual(HarshyTripBuffer.ringTarget(360_000), 352_800)
  }

  func testNeedsHysteresisBeforeIdle() {
    let gate = HarshyIdleGate()
    XCTAssertFalse(gate.advance(tMs: 1_000, speedMps: 0))
    XCTAssertFalse(gate.advance(tMs: 1_000 + HarshyTripBuffer.idleHysteresisMs - 1, speedMps: 0))
    XCTAssertTrue(gate.advance(tMs: 1_000 + HarshyTripBuffer.idleHysteresisMs, speedMps: 0))
  }

  func testClearsIdleWhenSpeedRises() {
    let gate = HarshyIdleGate()
    _ = gate.advance(tMs: 1_000, speedMps: 0)
    _ = gate.advance(tMs: 1_000 + HarshyTripBuffer.idleHysteresisMs, speedMps: 0)
    XCTAssertFalse(gate.advance(tMs: 5_000, speedMps: 5))
  }

  func testThrottlesIdleGpsBreadcrumbs() {
    let gate = HarshyIdleGate()
    _ = gate.advance(tMs: 1_000, speedMps: 0)
    _ = gate.advance(tMs: 1_000 + HarshyTripBuffer.idleHysteresisMs, speedMps: 0)
    XCTAssertTrue(gate.shouldKeepIdleLocation(tMs: 10_000, lat: 1, lon: 1))
    XCTAssertFalse(
      gate.shouldKeepIdleLocation(
        tMs: 10_000 + HarshyTripBuffer.idleLocationIntervalMs / 2,
        lat: 1,
        lon: 1
      )
    )
    XCTAssertTrue(
      gate.shouldKeepIdleLocation(
        tMs: 10_000 + HarshyTripBuffer.idleLocationIntervalMs,
        lat: 1,
        lon: 1
      )
    )
  }
}
