import XCTest
@testable import HarshyMath

final class HarshyEcoScoreTests: XCTestCase {
  func testRatioEndpoints() {
    XCTAssertEqual(harshyEcoScoreFromRatio(1), 100)
    XCTAssertEqual(harshyEcoScoreFromRatio(2), 50)
    XCTAssertEqual(harshyEcoScoreFromRatio(3), 0)
    XCTAssertEqual(harshyEcoScoreFromRatio(4), 0)
  }

  func testShortTripIsNull() {
    let eco = harshyEstimateTripEco(path(speeds: [13.9, 13.9], stepM: 10))
    XCTAssertNil(eco.ecoScore)
    XCTAssertEqual(eco.vehicleProfileId, "generic")
  }

  func testSteadyCruiseNear100() {
    let v = harshyGenericCarEco.vEffMps
    let eco = harshyEstimateTripEco(path(speeds: Array(repeating: v, count: 40), stepM: 20))
    XCTAssertNotNil(eco.ecoScore)
    XCTAssertGreaterThanOrEqual(eco.ecoScore!, 95)
    XCTAssertGreaterThan(eco.ecoRatio!, 0.9)
    XCTAssertLessThan(eco.ecoRatio!, 1.1)
  }

  func testStopAndGoWorseThanCruise() {
    let v = harshyGenericCarEco.vEffMps
    let cruise = harshyEstimateTripEco(path(speeds: Array(repeating: v, count: 40), stepM: 20))
    var choppy: [Double] = []
    for i in 0..<40 {
      choppy.append(i % 4 < 2 ? 2 : 22)
    }
    let busy = harshyEstimateTripEco(path(speeds: choppy, stepM: 20))
    XCTAssertNotNil(cruise.ecoScore)
    XCTAssertNotNil(busy.ecoScore)
    XCTAssertLessThan(busy.ecoScore!, cruise.ecoScore!)
    XCTAssertGreaterThan(busy.ecoRatio!, cruise.ecoRatio!)
  }

  private func path(speeds: [Double], stepM: Double, dtMs: Double = 1000) -> [HarshyLocationSample] {
    let dLat = stepM / 111_320
    return speeds.enumerated().map { i, speed in
      HarshyLocationSample(
        t: Double(i) * dtMs,
        lat: 32.08 + Double(i) * dLat,
        lon: 34.78,
        altitudeM: nil,
        speedMps: speed,
        courseDeg: nil,
        accuracyM: 5,
        altitudeAccuracyM: nil
      )
    }
  }
}
