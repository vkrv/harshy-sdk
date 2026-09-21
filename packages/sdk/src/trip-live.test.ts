import { describe, expect, it } from "vitest";

import { formatTripDurationMs, formatTripLiveDisplay } from "./trip-live";
import type { LiveMetrics } from "@harshy/core";

const base: LiveMetrics = {
  t: 0,
  speedMps: 10,
  speedKmh: 36,
  headingDeg: null,
  altitudeM: null,
  locationAccuracyM: null,
  longitudinalAccelMps2: null,
  lateralAccelMps2: null,
  verticalAccelMps2: null,
  accelMagnitudeMps2: null,
  gyroMagnitudeRadps: null,
  accelLevel: "norm",
  brakeLevel: "norm",
  cornerLevel: "norm",
  yawRateRadps: null,
  swerveLevel: "norm",
  distanceM: 3200,
  durationMs: 65_000,
  score: 97.4,
};

describe("formatTripLiveDisplay", () => {
  it("formats key numbers for the live notice", () => {
    expect(formatTripDurationMs(65_000)).toBe("1:05");
    expect(formatTripLiveDisplay(base, "Signumb")).toEqual({
      title: "Signumb",
      score: "97",
      speed: "36 km/h",
      duration: "1:05",
      distance: "3.20 km",
    });
  });
});
