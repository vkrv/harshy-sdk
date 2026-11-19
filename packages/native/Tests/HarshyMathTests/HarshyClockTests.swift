import XCTest
@testable import HarshyMath

final class HarshyClockTests: XCTestCase {
  private var elapsedMs: Int64 = 5_000
  private var wallMs: Int64 = 1_700_000_000_000

  private func makeClock() -> HarshyClock {
    HarshyClock.monotonic(elapsedRealtimeMs: { self.elapsedMs }, wallClockMs: { self.wallMs })
  }

  func testStartsAtTheWallClock() {
    XCTAssertEqual(makeClock().nowMs(), 1_700_000_000_000)
  }

  func testAdvancesWithTheBootClock() {
    let clock = makeClock()
    elapsedMs += 1_500
    XCTAssertEqual(clock.nowMs(), 1_700_000_001_500)
  }

  func testIgnoresWallClockJumpsAfterCreation() {
    let clock = makeClock()
    wallMs += 3_600_000
    elapsedMs += 10
    XCTAssertEqual(clock.nowMs(), 1_700_000_000_010)
  }

  func testConvertsDurationsToWholeMilliseconds() {
    XCTAssertEqual(HarshyClock.milliseconds(of: .milliseconds(1_500)), 1_500)
    XCTAssertEqual(HarshyClock.milliseconds(of: .seconds(2) + .microseconds(999)), 2_000)
    XCTAssertEqual(HarshyClock.milliseconds(of: .zero), 0)
  }

  func testDefaultMonotonicClockStartsAtTheWallClock() {
    let wallMs = Int64(Date().timeIntervalSince1970 * 1_000)
    XCTAssertLessThan(abs(HarshyClock.monotonic().nowMs() - wallMs), 1_000)
  }

  func testDefaultMonotonicClockNeverGoesBackwards() {
    let clock = HarshyClock.monotonic()
    let first = clock.nowMs()
    XCTAssertGreaterThanOrEqual(clock.nowMs(), first)
  }
}
