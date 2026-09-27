import { describe, expect, it } from "vitest";

import {
  confirmedYawRadps,
  derivedCourseDeg,
  derivedSpeedMps,
  haversineM,
  magnitude,
  toRad,
  unwrapDeltaDeg,
  wrapCourseDeg,
} from "./geo.js";

describe("geo", () => {
  it("computes a short haversine distance", () => {
    const metres = haversineM(
      { lat: 32.0853, lon: 34.7818 },
      { lat: 32.0863, lon: 34.7818 },
    );
    expect(metres).toBeGreaterThan(100);
    expect(metres).toBeLessThan(130);
  });

  it("unwraps heading across 0 degrees", () => {
    expect(unwrapDeltaDeg(350, 10)).toBeCloseTo(20);
    expect(unwrapDeltaDeg(10, 350)).toBeCloseTo(-20);
  });

  it("wraps course into 0–360", () => {
    expect(wrapCourseDeg(370)).toBeCloseTo(10);
    expect(wrapCourseDeg(-10)).toBeCloseTo(350);
    expect(wrapCourseDeg(360)).toBeCloseTo(0);
  });

  it("computes vector magnitude", () => {
    expect(magnitude({ x: 3, y: 4, z: 0 })).toBe(5);
  });

  it("prefers reported GNSS speed then infers from displacement", () => {
    const from = { t: 0, lat: 32.0853, lon: 34.7818, speedMps: null };
    const to = { t: 1000, lat: 32.0863, lon: 34.7818, speedMps: null };
    const inferred = derivedSpeedMps(from, to);
    expect(inferred).toBeGreaterThan(100);
    expect(inferred).toBeLessThan(130);
    expect(derivedSpeedMps(from, { ...to, speedMps: 8 })).toBe(8);
    expect(derivedSpeedMps(null, to)).toBeNull();
  });

  it("prefers reported GNSS course then infers from displacement", () => {
    const from = { t: 0, lat: 32.0853, lon: 34.7818, courseDeg: null };
    const east = { t: 1000, lat: 32.0853, lon: 34.7818 + 0.0002, courseDeg: null };
    const inferred = derivedCourseDeg(from, east);
    expect(inferred).toBeGreaterThan(80);
    expect(inferred).toBeLessThan(100);
    expect(derivedCourseDeg(from, { ...east, courseDeg: 12 })).toBeCloseTo(12);
    expect(derivedCourseDeg(null, east)).toBeNull();
  });

  it("uses the track when the chip course agrees, and only a mounted gyro when it does not", () => {
    const turn = toRad(26);
    expect(
      confirmedYawRadps({
        dtSec: 1,
        chipFromDeg: 0,
        chipToDeg: 26,
        pathFromDeg: 0,
        pathToDeg: 26,
        verticalGyroRadps: null,
        phoneHandheld: false,
      }),
    ).toBeCloseTo(turn);

    const straight = toRad(4);
    const glitch = toRad(unwrapDeltaDeg(240, 28));
    const disagree = {
      dtSec: 1,
      chipFromDeg: 240,
      chipToDeg: 28,
      pathFromDeg: 240,
      pathToDeg: 244,
    };
    expect(
      confirmedYawRadps({ ...disagree, verticalGyroRadps: 0.02, phoneHandheld: false }),
    ).toBeCloseTo(straight);
    expect(
      confirmedYawRadps({ ...disagree, verticalGyroRadps: glitch, phoneHandheld: false }),
    ).toBeCloseTo(glitch);
    expect(
      confirmedYawRadps({ ...disagree, verticalGyroRadps: glitch, phoneHandheld: true }),
    ).toBeCloseTo(straight);
    expect(
      confirmedYawRadps({ ...disagree, verticalGyroRadps: glitch * 4, phoneHandheld: false }),
    ).toBeCloseTo(straight);
    expect(
      confirmedYawRadps({
        dtSec: 1,
        chipFromDeg: 0,
        chipToDeg: 26,
        pathFromDeg: null,
        pathToDeg: null,
        verticalGyroRadps: null,
        phoneHandheld: false,
      }),
    ).toBeNull();
    expect(
      confirmedYawRadps({
        dtSec: 1,
        chipFromDeg: 0,
        chipToDeg: 26,
        pathFromDeg: null,
        pathToDeg: null,
        verticalGyroRadps: turn,
        phoneHandheld: false,
      }),
    ).toBeCloseTo(turn);
  });
});
