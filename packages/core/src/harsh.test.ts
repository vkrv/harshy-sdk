import { describe, expect, it } from "vitest";

import { DEFAULT_DETECTOR_CONFIG } from "./config.js";
import {
  harshEventLevel,
  harshLevel,
  harshLevelLabel,
  harshLevelRank,
  liveHarshLevels,
  longitudinalHarshLevel,
} from "./harsh.js";

describe("harshLevel", () => {
  it("is within norm below the threshold", () => {
    expect(harshLevel(2.4, 2.5)).toBe("norm");
    expect(harshLevel(0, 2.5)).toBe("norm");
  });

  it("splits harsh peaks into light, medium, and heavy", () => {
    expect(harshLevel(2.5, 2.5)).toBe("light");
    expect(harshLevel(3.74, 2.5)).toBe("light");
    expect(harshLevel(3.75, 2.5)).toBe("medium");
    expect(harshLevel(5, 2.5)).toBe("heavy");
  });

  it("never returns norm for an emitted event", () => {
    expect(harshEventLevel(2.4, 2.5)).toBe("light");
    expect(harshEventLevel(5, 2.5)).toBe("heavy");
  });
});

describe("harshLevelLabel", () => {
  it("names the four bands", () => {
    expect(harshLevelLabel("norm")).toBe("Within norm");
    expect(harshLevelLabel("light")).toBe("Light");
    expect(harshLevelRank("heavy")).toBeGreaterThan(harshLevelRank("light"));
    expect(longitudinalHarshLevel("light", "norm")).toBe("light");
    expect(longitudinalHarshLevel("norm", "heavy")).toBe("heavy");
  });
});

describe("liveHarshLevels", () => {
  it("stays within norm when not moving", () => {
    const levels = liveHarshLevels({
      moving: false,
      longitudinal: 8,
      lateral: 8,
      yawRateRadps: 2,
      config: DEFAULT_DETECTOR_CONFIG,
    });
    expect(levels).toEqual({
      accelLevel: "norm",
      brakeLevel: "norm",
      cornerLevel: "norm",
      swerveLevel: "norm",
    });
  });

  it("maps signed longitudinal accel to accel vs brake", () => {
    const accel = liveHarshLevels({
      moving: true,
      longitudinal: 3,
      lateral: 0,
      yawRateRadps: 0,
      config: DEFAULT_DETECTOR_CONFIG,
    });
    expect(accel.accelLevel).toBe("light");
    expect(accel.brakeLevel).toBe("norm");

    const brake = liveHarshLevels({
      moving: true,
      longitudinal: -8,
      lateral: 0,
      yawRateRadps: 0,
      config: DEFAULT_DETECTOR_CONFIG,
    });
    expect(brake.brakeLevel).toBe("heavy");
    expect(brake.accelLevel).toBe("norm");
  });

  it("flags a swerve from yaw rate", () => {
    const levels = liveHarshLevels({
      moving: true,
      longitudinal: 0,
      lateral: 0,
      yawRateRadps: 0.5,
      config: DEFAULT_DETECTOR_CONFIG,
    });
    expect(levels.swerveLevel).toBe("light");
  });
});
