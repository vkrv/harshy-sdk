import XCTest
@testable import HarshyMath

final class HarshyLocationThrottleTests: XCTestCase {
  func testAcceptsTheFirstFix() {
    XCTAssertTrue(HarshyLocationThrottle(intervalMs: 1_000).accept(0))
  }

  func testThinsAHalfSecondStreamToOneFixPerSecond() {
    let throttle = HarshyLocationThrottle(intervalMs: 1_000)
    let accepted = (0...6).map { Int64($0) * 500 }.filter { throttle.accept($0) }
    XCTAssertEqual(accepted, [0, 1_000, 2_000, 3_000])
  }

  func testToleratesFixesArrivingSlightlyEarly() {
    let throttle = HarshyLocationThrottle(intervalMs: 1_000)
    _ = throttle.accept(0)
    XCTAssertFalse(throttle.accept(899))
    XCTAssertTrue(throttle.accept(900))
  }
}
