import { describe, expect, it } from "vitest";

import {
  IDLE_HYSTERESIS_MS,
  IDLE_LOCATION_INTERVAL_MS,
  MAX_LOCATION_SAMPLES,
  advanceIdleMotion,
  emptyIdleMotionState,
  maxImuSamples,
  shouldKeepIdleLocation,
  trimRingBuffer,
} from "./tripBuffer.js";

describe("tripBuffer caps", () => {
  it("matches native IMU window formula", () => {
    expect(maxImuSamples(50)).toBe(50 * 60 * 120);
    expect(maxImuSamples(25)).toBe(25 * 60 * 120);
    expect(MAX_LOCATION_SAMPLES).toBe(20_000);
  });

  it("trims a ring buffer from the front", () => {
    const items = [1, 2, 3, 4, 5];
    trimRingBuffer(items, 3);
    expect(items).toEqual([3, 4, 5]);
  });

  it("chunk-drops with slack on large rings so overflow is amortized", () => {
    const max = 100;
    const items = Array.from({ length: max + 1 }, (_, i) => i);
    trimRingBuffer(items, max);
    // 2% of 100 → slack 2 → target 98
    expect(items.length).toBe(98);
    expect(items[0]).toBe(3);
    expect(items.at(-1)).toBe(100);
  });
});

describe("idle motion gate", () => {
  it("needs hysteresis before idle", () => {
    let state = emptyIdleMotionState();
    let idle = false;
    ({ state, idle } = advanceIdleMotion(state, { t: 1_000, speedMps: 0 }, 2));
    expect(idle).toBe(false);
    ({ state, idle } = advanceIdleMotion(
      state,
      { t: 1_000 + IDLE_HYSTERESIS_MS - 1, speedMps: 0 },
      2,
    ));
    expect(idle).toBe(false);
    ({ state, idle } = advanceIdleMotion(
      state,
      { t: 1_000 + IDLE_HYSTERESIS_MS, speedMps: 0 },
      2,
    ));
    expect(idle).toBe(true);
  });

  it("clears idle when speed rises", () => {
    let state = emptyIdleMotionState();
    ({ state } = advanceIdleMotion(state, { t: 1_000, speedMps: 0 }, 2));
    ({ state } = advanceIdleMotion(
      state,
      { t: 1_000 + IDLE_HYSTERESIS_MS, speedMps: 0 },
      2,
    ));
    const moved = advanceIdleMotion(state, { t: 5_000, speedMps: 5 }, 2);
    expect(moved.idle).toBe(false);
  });

  it("throttles idle GPS breadcrumbs", () => {
    let state = emptyIdleMotionState();
    const first = shouldKeepIdleLocation(state, { t: 10_000, lat: 1, lon: 1 });
    expect(first.keep).toBe(true);
    state = first.state;
    const soon = shouldKeepIdleLocation(state, {
      t: 10_000 + IDLE_LOCATION_INTERVAL_MS / 2,
      lat: 1,
      lon: 1,
    });
    expect(soon.keep).toBe(false);
    const later = shouldKeepIdleLocation(state, {
      t: 10_000 + IDLE_LOCATION_INTERVAL_MS,
      lat: 1,
      lon: 1,
    });
    expect(later.keep).toBe(true);
  });
});
