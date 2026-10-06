import { describe, expect, it } from "vitest";

import { analyzeTrip } from "./detector.js";
import {
  generateSampleTrip,
  LIVE_SIM_VARIANTS,
  SIM_TRIP_VARIANTS,
  type SimTripVariant,
} from "./simulate.js";

function metersBetween(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const lat = (((a.lat + b.lat) / 2) * Math.PI) / 180;
  const dy = (b.lat - a.lat) * 111_320;
  const dx = (b.lon - a.lon) * 111_320 * Math.cos(lat);
  return Math.hypot(dx, dy);
}

function signedCourseStep(from: number, to: number): number {
  return ((((to - from + 180) % 360) + 360) % 360) - 180;
}

function summarize(variant: SimTripVariant, headingOffsetDeg = 0) {
  const trip = generateSampleTrip({ variant, headingOffsetDeg });
  const session = analyzeTrip({
    location: trip.location,
    imu: trip.imu,
    sessionId: trip.sessionId,
    startedAtMs: trip.startedAtMs,
    endedAtMs: trip.endedAtMs,
    device: { platform: "web", model: "sim" },
  });
  const courses = trip.location.map((sample) => sample.courseDeg ?? 0);
  let left = false;
  let right = false;
  for (let i = 1; i < courses.length; i += 1) {
    const step = signedCourseStep(courses[i - 1] ?? 0, courses[i] ?? 0);
    if (step > 2) {
      right = true;
    }
    if (step < -2) {
      left = true;
    }
  }
  return {
    types: new Set(session.events.map((event) => event.type)),
    left,
    right,
    distanceM: session.metrics.distanceM,
  };
}

describe("simulated trips", () => {
  it("keeps the original sample when no variant is asked for", () => {
    const trip = generateSampleTrip();
    expect(trip.endedAtMs - trip.startedAtMs).toBe(55_000);
    expect(trip.location[0]?.courseDeg).toBe(0);
    expect(trip.location.at(-1)?.courseDeg).toBe(157);
  });

  it("plays three different shapes, not the same hook", () => {
    const summaries = SIM_TRIP_VARIANTS.map((variant) => ({ variant, ...summarize(variant) }));
    for (const summary of summaries) {
      expect(summary.distanceM).toBeGreaterThan(100);
      expect(summary.types.has("possible_impact")).toBe(false);
      expect([...summary.types].some((type) => type.startsWith("harsh_"))).toBe(true);
    }

    const reach = (variant: SimTripVariant) => {
      const trip = generateSampleTrip({ variant });
      const start = trip.location[0];
      const end = trip.location.at(-1);
      if (!start || !end) {
        throw new Error("empty trip");
      }
      let max = 0;
      for (const sample of trip.location) {
        max = Math.max(max, metersBetween(start, sample));
      }
      return { end: metersBetween(start, end), max };
    };

    const sample = reach("sample");
    const loop = reach("loop");
    const back = reach("return");
    const slalom = summaries.find((item) => item.variant === "slalom");

    expect(sample.end).toBeGreaterThan(200);
    expect(loop.max).toBeGreaterThan(60);
    expect(loop.end).toBeLessThan(40);
    expect(back.max).toBeGreaterThan(100);
    expect(back.end).toBeLessThan(back.max * 0.45);
    expect(slalom?.left).toBe(true);
    expect(slalom?.right).toBe(true);
    expect(slalom?.types.has("swerve")).toBe(true);
    expect(summaries.find((item) => item.variant === "return")?.types.has("harsh_corner")).toBe(true);
    expect(LIVE_SIM_VARIANTS).not.toContain("sample");
  });

  it("stays inside a loose retune and still harsh at a tight one", () => {
    for (const variant of SIM_TRIP_VARIANTS) {
      const trip = generateSampleTrip({ variant });
      const base = {
        location: trip.location,
        imu: trip.imu,
        sessionId: trip.sessionId,
        startedAtMs: trip.startedAtMs,
        endedAtMs: trip.endedAtMs,
        device: { platform: "web" as const, model: "sim" },
      };
      const loose = analyzeTrip({
        ...base,
        config: { harshAccelMps2: 20, harshBrakeMps2: 20, harshCornerMps2: 20 },
      });
      const strict = analyzeTrip({
        ...base,
        config: { harshAccelMps2: 1, harshBrakeMps2: 1, harshCornerMps2: 1 },
      });
      expect(loose.events.some((event) => event.type.startsWith("harsh_"))).toBe(false);
      expect(strict.events.some((event) => event.type.startsWith("harsh_"))).toBe(true);
    }
  });

  it("rotates a drive without changing which events fire", () => {
    for (const variant of SIM_TRIP_VARIANTS) {
      const plain = summarize(variant, 0);
      const turned = summarize(variant, 137);
      expect([...turned.types].sort()).toEqual([...plain.types].sort());
      const trip = generateSampleTrip({ variant, headingOffsetDeg: 137 });
      expect(trip.location[0]?.courseDeg).not.toBe(generateSampleTrip({ variant }).location[0]?.courseDeg);
    }
  });
});
