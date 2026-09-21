import { describe, expect, it } from "vitest";

import {
  compensateDrivePath,
  isCoarseNetworkLikeFix,
  isPlausibleDriveStep,
  shouldAcceptDriveFix,
  type DriveFixPoint,
} from "./drivePath.js";
import { haversineM } from "./geo.js";

describe("drivePath", () => {
  it("rejects coarse network-like fixes even as the first sample", () => {
    const coarse: DriveFixPoint = {
      t: 732,
      lat: 59.4395306,
      lon: 24.868772,
      speedMps: null,
    };
    expect(isCoarseNetworkLikeFix(coarse)).toBe(true);
    expect(shouldAcceptDriveFix(null, coarse, 0).accept).toBe(false);
  });

  it("accepts GNSS-quality fixes that omit speed", () => {
    const gnss: DriveFixPoint = {
      t: 500,
      lat: 59.4425032,
      lon: 24.8530124,
      speedMps: null,
      accuracyM: 8,
    };
    expect(isCoarseNetworkLikeFix(gnss)).toBe(false);
    expect(shouldAcceptDriveFix(null, gnss, 0).accept).toBe(true);
  });

  it("rejects an impossible teleport step", () => {
    const from: DriveFixPoint = {
      t: 0,
      lat: 59.44803481455892,
      lon: 24.862493975088,
      speedMps: 4.42,
    };
    const spike: DriveFixPoint = {
      t: 732,
      lat: 59.4395306,
      lon: 24.868772,
      speedMps: null,
    };
    expect(haversineM(from, spike)).toBeGreaterThan(900);
    expect(isPlausibleDriveStep(from, spike)).toBe(false);
    expect(shouldAcceptDriveFix(from, spike, 0).accept).toBe(false);
  });

  it("accepts after enough consecutive rejects (segment reset)", () => {
    const from: DriveFixPoint = { t: 0, lat: 59.4, lon: 24.7, speedMps: 10 };
    // Fine coords so coarse filter does not apply — speed gate only.
    const far: DriveFixPoint = {
      t: 1000,
      lat: 59.50000012345678,
      lon: 24.90000012345678,
      speedMps: 10,
    };
    let rejects = 0;
    for (let i = 0; i < 9; i += 1) {
      const decision = shouldAcceptDriveFix(from, far, rejects);
      expect(decision.accept).toBe(false);
      rejects = decision.rejects;
    }
    expect(shouldAcceptDriveFix(from, far, rejects).accept).toBe(true);
  });

  it("batch-compensates out-and-back spikes and coarse injects", () => {
    const points: DriveFixPoint[] = [
      { t: 0, lat: 59.437, lon: 24.75, speedMps: 12 },
      { t: 1000, lat: 59.4371, lon: 24.7502, speedMps: 12 },
      { t: 1500, lat: 59.45, lon: 24.78, speedMps: null },
      { t: 2000, lat: 59.4395306, lon: 24.868772, speedMps: null },
      { t: 3000, lat: 59.4372, lon: 24.7504, speedMps: 12 },
    ];
    const cleaned = compensateDrivePath(points);
    expect(cleaned.some((p) => p.lat === 59.45)).toBe(false);
    expect(cleaned.some((p) => p.lat === 59.4395306)).toBe(false);
    expect(cleaned.length).toBeGreaterThanOrEqual(3);
  });
});
