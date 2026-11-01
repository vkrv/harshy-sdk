import { describe, expect, it } from "vitest";

import {
  GENERIC_CAR_ECO,
  ecoScoreFromRatio,
  estimateTripEco,
  type EcoSample,
} from "./ecoScore.js";

describe("ecoScoreFromRatio", () => {
  it("maps 1→100, 2→50, 3→0", () => {
    expect(ecoScoreFromRatio(1)).toBe(100);
    expect(ecoScoreFromRatio(2)).toBe(50);
    expect(ecoScoreFromRatio(3)).toBe(0);
    expect(ecoScoreFromRatio(4)).toBe(0);
  });
});

function path(speeds: number[], stepM = 20, dtMs = 1000): EcoSample[] {
  const samples: EcoSample[] = [];
  let lat = 32.08;
  const lon = 34.78;
  // ~111_320 m per degree lat
  const dLat = stepM / 111_320;
  for (let i = 0; i < speeds.length; i += 1) {
    samples.push({
      t: i * dtMs,
      lat: lat + i * dLat,
      lon,
      speedMps: speeds[i]!,
    });
  }
  return samples;
}

describe("estimateTripEco", () => {
  it("returns null for a short trip", () => {
    const samples = path([13.9, 13.9], 10, 1000);
    const eco = estimateTripEco(samples);
    expect(eco.ecoScore).toBeNull();
    expect(eco.vehicleProfileId).toBe("generic");
  });

  it("scores a steady efficient cruise near 100", () => {
    const v = GENERIC_CAR_ECO.vEffMps;
    const samples = path(Array.from({ length: 40 }, () => v), 20, 1000);
    const eco = estimateTripEco(samples);
    expect(eco.ecoScore).not.toBeNull();
    expect(eco.ecoScore!).toBeGreaterThanOrEqual(95);
    expect(eco.ecoRatio!).toBeGreaterThan(0.9);
    expect(eco.ecoRatio!).toBeLessThan(1.1);
  });

  it("scores hard accel / stop-and-go worse than cruise", () => {
    const v = GENERIC_CAR_ECO.vEffMps;
    const cruise = estimateTripEco(path(Array.from({ length: 40 }, () => v), 20, 1000));
    const choppy: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      choppy.push(i % 4 < 2 ? 2 : 22);
    }
    const busy = estimateTripEco(path(choppy, 20, 1000));
    expect(cruise.ecoScore).not.toBeNull();
    expect(busy.ecoScore).not.toBeNull();
    expect(busy.ecoScore!).toBeLessThan(cruise.ecoScore!);
    expect(busy.ecoRatio!).toBeGreaterThan(cruise.ecoRatio!);
  });

  it("uses provided distanceM for the optimal floor", () => {
    const v = GENERIC_CAR_ECO.vEffMps;
    const samples = path(Array.from({ length: 30 }, () => v), 25, 1000);
    const eco = estimateTripEco(samples, { distanceM: 800 });
    expect(eco.ecoOptimal).toBeCloseTo(
      GENERIC_CAR_ECO.rolling * 800 + GENERIC_CAR_ECO.aero * v * v * 800,
      4,
    );
  });
});
