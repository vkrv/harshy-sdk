import XCTest
@testable import HarshyMath

final class HarshyWatchActivityTests: XCTestCase {
  func testAutomotiveWinsOverWalking() {
    XCTAssertEqual(
      harshyWatchActivityPick(
        automotive: true,
        cycling: false,
        running: false,
        walking: true,
        stationary: false
      ),
      "automotive"
    )
  }

  func testUnknownWhenNoFlags() {
    XCTAssertEqual(
      harshyWatchActivityPick(
        automotive: false,
        cycling: false,
        running: false,
        walking: false,
        stationary: false
      ),
      "unknown"
    )
  }

  func testWalkingWhenOnlyWalking() {
    XCTAssertEqual(
      harshyWatchActivityPick(
        automotive: false,
        cycling: false,
        running: false,
        walking: true,
        stationary: true
      ),
      "walking"
    )
  }
}
