import XCTest
@testable import HarshyMath

final class HarshyHeadingTests: XCTestCase {
  private let minSpeed = HarshyDetectorConfig.default.minSpeedMps

  private func loc(_ t: Double, speedMps: Double, courseDeg: Double) -> HarshyLocationSample {
    HarshyLocationSample(t: t, lat: 32, lon: 34, speedMps: speedMps, courseDeg: courseDeg, accuracyM: 5)
  }

  func testWrapsCourseIntoCircle() {
    XCTAssertEqual(harshyWrapCourseDeg(370), 10, accuracy: 0.001)
    XCTAssertEqual(harshyWrapCourseDeg(-10), 350, accuracy: 0.001)
  }

  func testStaysBlankWhileStopped() {
    var filter = harshyEmptyHeadingFilter()
    filter = harshyAdvanceHeadingFilter(filter, sample: loc(0, speedMps: 0, courseDeg: 12), minSpeedMps: minSpeed)
    filter = harshyAdvanceHeadingFilter(filter, sample: loc(500, speedMps: 0.4, courseDeg: 200), minSpeedMps: minSpeed)
    XCTAssertNil(filter.headingDeg)
  }

  func testLocksAfterTwoAgreeingMovingFixesThenHolds() {
    var filter = harshyEmptyHeadingFilter()
    filter = harshyAdvanceHeadingFilter(filter, sample: loc(0, speedMps: 6, courseDeg: 88), minSpeedMps: minSpeed)
    XCTAssertNil(filter.headingDeg)
    filter = harshyAdvanceHeadingFilter(filter, sample: loc(500, speedMps: 6, courseDeg: 90), minSpeedMps: minSpeed)
    let locked = filter.headingDeg
    XCTAssertNotNil(locked)
    XCTAssertEqual(locked!, 89, accuracy: 2)
    filter = harshyAdvanceHeadingFilter(filter, sample: loc(1000, speedMps: 0, courseDeg: 15), minSpeedMps: minSpeed)
    filter = harshyAdvanceHeadingFilter(filter, sample: loc(1500, speedMps: 0.3, courseDeg: 300), minSpeedMps: minSpeed)
    XCTAssertEqual(filter.headingDeg!, locked!, accuracy: 0.001)
  }

  func testHarshBandsSplitAtMediumAndHeavy() {
    XCTAssertEqual(harshyLevel(peak: 2.4, threshold: 2.5, mediumX: 1.5, heavyX: 2), "norm")
    XCTAssertEqual(harshyLevel(peak: 2.5, threshold: 2.5, mediumX: 1.5, heavyX: 2), "light")
    XCTAssertEqual(harshyLevel(peak: 3.75, threshold: 2.5, mediumX: 1.5, heavyX: 2), "medium")
    XCTAssertEqual(harshyLevel(peak: 5, threshold: 2.5, mediumX: 1.5, heavyX: 2), "heavy")
    XCTAssertEqual(harshyEventLevel(peak: 1, threshold: 2.5, mediumX: 1.5, heavyX: 2), "light")
  }
}
