import { describe, expect, it } from "vitest";

import { parseLocationSample, parseWatchFix } from "./parse-samples";

describe("parseWatchFix", () => {
  it("reads a sparse watch sample", () => {
    expect(
      parseWatchFix({
        t: 10,
        lat: 32.1,
        lon: 34.8,
        speedMps: 12,
        accuracyM: 8,
        activity: "automotive",
      }),
    ).toEqual({
      t: 10,
      lat: 32.1,
      lon: 34.8,
      speedMps: 12,
      accuracyM: 8,
      activity: "automotive",
    });
  });

  it("defaults activity and drops non-finite coords", () => {
    expect(
      parseWatchFix({
        t: 1,
        lat: Number.NaN,
        activity: "hover",
      }),
    ).toEqual({
      t: 1,
      lat: null,
      lon: null,
      speedMps: null,
      accuracyM: null,
      activity: "unknown",
    });
  });

  it("rejects payloads without a timestamp", () => {
    expect(parseWatchFix({ lat: 1, lon: 2 })).toBeNull();
    expect(parseWatchFix(null)).toBeNull();
  });
});

describe("parseLocationSample", () => {
  it("fills omitted nullable fields so native bridges still parse", () => {
    expect(
      parseLocationSample({
        t: 10,
        lat: 59.437,
        lon: 24.753,
      }),
    ).toEqual({
      t: 10,
      lat: 59.437,
      lon: 24.753,
      altitudeM: null,
      speedMps: null,
      courseDeg: null,
      accuracyM: null,
      altitudeAccuracyM: null,
    });
  });

  it("coerces string numbers from the native bridge", () => {
    const sample = parseLocationSample({
      t: "1000",
      lat: "32.1",
      lon: "34.8",
      speedMps: "12.5",
      accuracyM: "6",
    });
    expect(sample?.speedMps).toBeCloseTo(12.5);
    expect(sample?.accuracyM).toBe(6);
  });
});
