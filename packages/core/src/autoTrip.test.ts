import { describe, expect, it } from "vitest";

import {
  DEFAULT_TRIP_HEURISTIC_CONFIG,
  emptyTripEndState,
  emptyTripStartState,
  endedAtMsWithoutIdleTail,
  commitStartConfig,
  locationToWatchFix,
  mergeTripHeuristicConfig,
  parseTripTrigger,
  shouldEndTrip,
  shouldStartTrip,
  trimIdleTailSamples,
  warmupEndConfig,
  type WatchFix,
} from "./autoTrip.js";

function fix(partial: Partial<WatchFix> & { t: number; lat: number; lon: number }): WatchFix {
  return {
    speedMps: 8,
    accuracyM: 8,
    activity: "unknown",
    ...partial,
  };
}

/** ~11 m east per 0.0001 lon at this latitude. */
function east(t: number, meters: number, speedMps = 8): WatchFix {
  const lon = 34 + meters / 111_320;
  return fix({ t, lat: 32, lon, speedMps });
}

describe("trip start heuristic", () => {
  it("does not start on a single fast fix", () => {
    const decided = shouldStartTrip(emptyTripStartState(), east(0, 0));
    expect(decided.start).toBe(false);
  });

  it("starts after hold + distance at vehicle speed", () => {
    let state = emptyTripStartState();
    let started = false;
    for (let i = 0; i <= 8; i += 1) {
      const decided = shouldStartTrip(state, east(i * 1000, i * 12));
      state = decided.state;
      started = started || decided.start;
    }
    expect(started).toBe(true);
    expect(state.distanceM).toBeGreaterThanOrEqual(DEFAULT_TRIP_HEURISTIC_CONFIG.startDistanceM);
  });

  it("does not probe-start before 5 s and 40 m", () => {
    let state = emptyTripStartState();
    for (let i = 0; i <= 4; i += 1) {
      const decided = shouldStartTrip(state, east(i * 1000, i * 8));
      state = decided.state;
      expect(decided.start).toBe(false);
    }
  });

  it("needs commit hold and distance after warmup start", () => {
    const commit = commitStartConfig();
    expect(commit.startHoldMs).toBe(DEFAULT_TRIP_HEURISTIC_CONFIG.commitHoldMs);
    expect(commit.startDistanceM).toBe(DEFAULT_TRIP_HEURISTIC_CONFIG.commitDistanceM);
    let state = emptyTripStartState();
    let committed = false;
    for (let i = 0; i <= 8; i += 1) {
      const decided = shouldStartTrip(state, east(i * 1000, i * 12), commit);
      state = decided.state;
      committed = committed || decided.start;
    }
    expect(committed).toBe(false);
    for (let i = 9; i <= 25; i += 1) {
      const decided = shouldStartTrip(state, east(i * 1000, i * 12), commit);
      state = decided.state;
      committed = committed || decided.start;
    }
    expect(committed).toBe(true);
    expect(state.distanceM).toBeGreaterThanOrEqual(DEFAULT_TRIP_HEURISTIC_CONFIG.commitDistanceM);
  });

  it("counts 10 km/h as driving speed", () => {
    const gate = 10 / 3.6;
    expect(DEFAULT_TRIP_HEURISTIC_CONFIG.startSpeedMps).toBeCloseTo(gate);
    const slow = shouldStartTrip(emptyTripStartState(), east(0, 0, gate - 0.05));
    const reset = shouldStartTrip(slow.state, east(1_000, 10, gate - 0.05));
    expect(reset.state.movingSinceMs).toBeNull();
    expect(reset.state.distanceM).toBe(0);
    const moving = shouldStartTrip(emptyTripStartState(), east(0, 0, gate));
    const kept = shouldStartTrip(moving.state, east(1_000, 10, gate));
    expect(kept.state.movingSinceMs).toBe(0);
    expect(kept.state.distanceM).toBeGreaterThan(0);
  });

  it("resets when speed drops below the start gate", () => {
    let state = emptyTripStartState();
    state = shouldStartTrip(state, east(0, 0)).state;
    state = shouldStartTrip(state, east(10_000, 80)).state;
    const dropped = shouldStartTrip(state, east(11_000, 90, 1));
    expect(dropped.start).toBe(false);
    expect(dropped.state.movingSinceMs).toBeNull();
    expect(dropped.state.distanceM).toBe(0);
  });

  it("blocks cycling when rejectNonAutomotive is on", () => {
    let state = emptyTripStartState();
    let started = false;
    for (let i = 0; i <= 25; i += 1) {
      const decided = shouldStartTrip(
        state,
        { ...east(i * 1000, i * 12), activity: "cycling" },
      );
      state = decided.state;
      started = started || decided.start;
    }
    expect(started).toBe(false);
  });

  it("starts when walking is labeled at vehicle speed (pocket steps)", () => {
    let state = emptyTripStartState();
    let started = false;
    for (let i = 0; i <= 25; i += 1) {
      const decided = shouldStartTrip(
        state,
        { ...east(i * 1000, i * 12), activity: "walking" },
      );
      state = decided.state;
      started = started || decided.start;
    }
    expect(started).toBe(true);
  });

  it("still blocks slow walking", () => {
    let state = emptyTripStartState();
    let started = false;
    for (let i = 0; i <= 25; i += 1) {
      const decided = shouldStartTrip(
        state,
        { ...east(i * 1000, i * 12, 1.5), activity: "walking" },
      );
      state = decided.state;
      started = started || decided.start;
    }
    expect(started).toBe(false);
  });

  it("infers speed from displacement when GNSS omits it", () => {
    let state = emptyTripStartState();
    let started = false;
    for (let i = 0; i <= 25; i += 1) {
      const decided = shouldStartTrip(state, { ...east(i * 1000, i * 12), speedMps: null });
      state = decided.state;
      started = started || decided.start;
    }
    expect(started).toBe(true);
  });

  it("treats GNSS speed 0 like missing and infers from displacement", () => {
    let state = emptyTripStartState();
    let started = false;
    for (let i = 0; i <= 25; i += 1) {
      const decided = shouldStartTrip(state, { ...east(i * 1000, i * 12), speedMps: 0 });
      state = decided.state;
      started = started || decided.start;
    }
    expect(started).toBe(true);
  });

  it("resets start accumulation after a GPS gap with no speed", () => {
    let state = emptyTripStartState();
    state = shouldStartTrip(state, east(0, 0)).state;
    state = shouldStartTrip(state, east(10_000, 80)).state;
    expect(state.distanceM).toBeGreaterThan(0);
    const gapped = shouldStartTrip(state, { ...east(80_000, 90), speedMps: null });
    expect(gapped.start).toBe(false);
    expect(gapped.state.movingSinceMs).toBeNull();
    expect(gapped.state.distanceM).toBe(0);
  });

  it("still starts on unknown activity (soft F-mode)", () => {
    let state = emptyTripStartState();
    let started = false;
    for (let i = 0; i <= 25; i += 1) {
      const decided = shouldStartTrip(state, {
        ...east(i * 1000, i * 12),
        activity: "unknown",
      });
      state = decided.state;
      started = started || decided.start;
    }
    expect(started).toBe(true);
  });

  it("ignores poor accuracy instead of accumulating", () => {
    const first = shouldStartTrip(emptyTripStartState(), east(0, 0));
    const noisy = shouldStartTrip(first.state, {
      ...east(20_000, 400),
      accuracyM: 200,
    });
    expect(noisy.start).toBe(false);
    expect(noisy.state.distanceM).toBe(first.state.distanceM);
  });

  it("does not start without coordinates", () => {
    const decided = shouldStartTrip(emptyTripStartState(), {
      t: 30_000,
      lat: null,
      lon: null,
      speedMps: 20,
      accuracyM: 5,
      activity: "automotive",
    });
    expect(decided.start).toBe(false);
  });
});

describe("trip end heuristic", () => {
  it("does not end while still moving", () => {
    const decided = shouldEndTrip(emptyTripEndState(), east(0, 0, 12));
    expect(decided.end).toBe(false);
    expect(decided.state.slowSinceMs).toBeNull();
  });

  it("does not end before the default 10 min park", () => {
    let state = emptyTripEndState();
    state = shouldEndTrip(state, east(0, 0, 0)).state;
    expect(shouldEndTrip(state, east(180_000, 5, 0)).end).toBe(false);
    expect(shouldEndTrip(state, east(599_999, 5, 0)).end).toBe(false);
    expect(DEFAULT_TRIP_HEURISTIC_CONFIG.endHoldMs).toBe(600_000);
    expect(shouldEndTrip(state, east(600_000, 5, 0)).end).toBe(true);
  });

  it("aborts warmup after 30 s parked, not 29 s", () => {
    const warmup = warmupEndConfig();
    expect(warmup.endHoldMs).toBe(DEFAULT_TRIP_HEURISTIC_CONFIG.warmupEndHoldMs);
    let state = emptyTripEndState();
    state = shouldEndTrip(state, east(0, 0, 0), warmup).state;
    expect(shouldEndTrip(state, east(29_999, 5, 0), warmup).end).toBe(false);
    expect(shouldEndTrip(state, east(30_000, 5, 0), warmup).end).toBe(true);
  });

  it("aborts warmup after a 30 s GPS silence that resumes already parked", () => {
    const warmup = warmupEndConfig();
    let state = emptyTripEndState();
    state = shouldEndTrip(state, east(0, 0, 11), warmup).state;
    const resumed = shouldEndTrip(state, east(30_000, 12, 0.4), warmup);
    expect(resumed.end).toBe(true);
    expect(resumed.state.slowSinceMs).toBe(0);
  });

  it("ends after a low-speed dwell inside the radius", () => {
    const config = mergeTripHeuristicConfig({ endHoldMs: 60_000, endRadiusM: 80 });
    let state = emptyTripEndState();
    state = shouldEndTrip(state, east(0, 0, 0), config).state;
    const parked = shouldEndTrip(state, east(60_000, 5, 0), config);
    expect(parked.end).toBe(true);
  });

  it("resets dwell when crawling beyond the radius (traffic, not parked)", () => {
    const config = mergeTripHeuristicConfig({ endHoldMs: 60_000, endRadiusM: 80 });
    let state = emptyTripEndState();
    state = shouldEndTrip(state, east(0, 0, 1), config).state;
    const crawled = shouldEndTrip(state, east(60_000, 200, 1), config);
    expect(crawled.end).toBe(false);
    expect(crawled.state.slowSinceMs).toBe(60_000);
  });

  it("resets when speed returns above the end gate", () => {
    let state = emptyTripEndState();
    state = shouldEndTrip(state, east(0, 0, 0)).state;
    const moving = shouldEndTrip(state, east(10_000, 10, 8));
    expect(moving.end).toBe(false);
    expect(moving.state.slowSinceMs).toBeNull();
  });

  it("treats GNSS speed 0 as parked when displacement stays inside the lot", () => {
    let state = emptyTripEndState();
    state = shouldEndTrip(state, east(0, 0, 0)).state;
    expect(state.slowSinceMs).toBe(0);
    const still = shouldEndTrip(state, east(1_000, 12, 0));
    expect(still.end).toBe(false);
    expect(still.state.slowSinceMs).toBe(0);
  });

  it("infers driving when GNSS omits speed", () => {
    let state = emptyTripEndState();
    state = shouldEndTrip(state, east(0, 0, 12)).state;
    const coast = shouldEndTrip(state, { ...east(1_000, 12), speedMps: null });
    expect(coast.end).toBe(false);
    expect(coast.state.slowSinceMs).toBeNull();
  });

  it("does not start dwell on a short GPS gap with no speed", () => {
    let state = emptyTripEndState();
    state = shouldEndTrip(state, east(0, 0, 12)).state;
    const gap = shouldEndTrip(state, { ...east(90_000, 12), speedMps: null });
    expect(gap.end).toBe(false);
    expect(gap.state.slowSinceMs).toBeNull();
  });

  it("keeps a dwell across a short GPS gap", () => {
    let state = emptyTripEndState();
    state = shouldEndTrip(state, east(0, 0, 0)).state;
    expect(state.slowSinceMs).toBe(0);
    const gap = shouldEndTrip(state, { ...east(90_000, 5), speedMps: null });
    expect(gap.end).toBe(false);
    expect(gap.state.slowSinceMs).toBe(0);
    expect(shouldEndTrip(gap.state, east(600_000, 5, 0)).end).toBe(true);
  });

  it("ends after a long GPS silence that resumes already parked", () => {
    let state = emptyTripEndState();
    state = shouldEndTrip(state, east(0, 0, 11)).state;
    expect(state.slowSinceMs).toBeNull();
    const resumed = shouldEndTrip(state, east(600_000, 40, 0.4));
    expect(resumed.end).toBe(true);
    expect(resumed.state.slowSinceMs).toBe(0);
  });

  it("ends when a long GPS silence resumes with null speed but tiny displacement", () => {
    let state = emptyTripEndState();
    state = shouldEndTrip(state, east(0, 0, 11)).state;
    const resumed = shouldEndTrip(state, { ...east(600_000, 40), speedMps: null });
    expect(resumed.end).toBe(true);
    expect(resumed.state.slowSinceMs).toBe(0);
  });

  it("does not silence-end when GPS resumes still moving", () => {
    let state = emptyTripEndState();
    state = shouldEndTrip(state, east(0, 0, 11)).state;
    const resumed = shouldEndTrip(state, east(600_000, 200, 10));
    expect(resumed.end).toBe(false);
    expect(resumed.state.slowSinceMs).toBeNull();
  });
});

describe("watch helpers", () => {
  it("maps a location sample to a watch fix", () => {
    expect(
      locationToWatchFix({
        t: 1,
        lat: 32,
        lon: 34,
        speedMps: 9,
        accuracyM: 4,
      }),
    ).toEqual({
      t: 1,
      lat: 32,
      lon: 34,
      speedMps: 9,
      accuracyM: 4,
      activity: "unknown",
    });
  });
});

describe("parseTripTrigger", () => {
  it("keeps auto and treats everything else as manual", () => {
    expect(parseTripTrigger("auto")).toBe("auto");
    expect(parseTripTrigger("manual")).toBe("manual");
    expect(parseTripTrigger(undefined)).toBe("manual");
    expect(parseTripTrigger("watch")).toBe("manual");
  });
});

describe("idle tail trim", () => {
  it("keeps samples through the parked start and drops the dwell after", () => {
    expect(trimIdleTailSamples([{ t: 1 }, { t: 10 }, { t: 11 }], 10)).toEqual([{ t: 1 }, { t: 10 }]);
  });

  it("ends the trip at idle start, not at the later stop clock", () => {
    expect(endedAtMsWithoutIdleTail(1_000, 61_000, 661_000)).toBe(61_000);
    expect(endedAtMsWithoutIdleTail(1_000, 500, 661_000)).toBe(1_000);
  });
});
