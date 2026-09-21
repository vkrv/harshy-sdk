import { describe, expect, it } from "vitest";

import { analyzeTrip, createTripAnalyzer, scoreEvents } from "./detector.js";
import {
  classifyImpactDirection,
  gravityTiltDeg,
  impactDirectionLabel,
  isPossibleImpact,
  verticalShare,
} from "./impact.js";
import type { DetectorConfig, ImuSample, LocationSample, Vec3 } from "./types.js";

const gravityUp: Vec3 = { x: 0, y: 0, z: 9.81 };

const quietConfig: Partial<DetectorConfig> = {
  harshAccelMps2: 50,
  harshBrakeMps2: 50,
  harshCornerMps2: 50,
};

function loc(t: number, speedMps: number): LocationSample {
  return {
    t,
    lat: 32,
    lon: 34 + t / 10_000_000,
    altitudeM: null,
    speedMps,
    courseDeg: 0,
    accuracyM: 5,
    altitudeAccuracyM: null,
  };
}

function restImu(t: number, gravity: Vec3 = gravityUp): ImuSample {
  return {
    t,
    accel: gravity,
    linearAccel: { x: 0, y: 0, z: 0 },
    gyro: null,
    magnetometer: null,
    attitude: null,
    gravity,
    barometerHpa: null,
  };
}

function pulseImu(t: number, linear: Vec3, gravity: Vec3 = gravityUp): ImuSample {
  return {
    t,
    accel: {
      x: linear.x + gravity.x,
      y: linear.y + gravity.y,
      z: linear.z + gravity.z,
    },
    linearAccel: linear,
    gyro: null,
    magnetometer: null,
    attitude: null,
    gravity,
    barometerHpa: null,
  };
}

/** ~120 ms horizontal pulse at 25 Hz, then rest so the pulse closes. */
function horizontalPulse(t0: number, peak = 40, gravity: Vec3 = gravityUp): ImuSample[] {
  const dt = 40;
  const samples: ImuSample[] = [];
  for (let i = 0; i < 4; i += 1) {
    samples.push(pulseImu(t0 + i * dt, { x: peak, y: 0, z: 0 }, gravity));
  }
  samples.push(restImu(t0 + 4 * dt, gravity));
  return samples;
}

function runTrip(args: {
  imu: ImuSample[];
  location: LocationSample[];
  endedAtMs: number;
  config?: Partial<DetectorConfig>;
}) {
  return analyzeTrip({
    location: args.location,
    imu: args.imu,
    sessionId: "impact",
    startedAtMs: 0,
    endedAtMs: args.endedAtMs,
    device: { platform: "web", model: "test" },
    config: { ...quietConfig, ...args.config },
  });
}

describe("impact helpers", () => {
  it("treats a sideways jolt as not vertical and a pothole as vertical", () => {
    expect(verticalShare({ x: 40, y: 0, z: 0 }, gravityUp)).toBeLessThan(0.1);
    expect(verticalShare({ x: 0, y: 0, z: 40 }, gravityUp)).toBeGreaterThan(0.95);
  });

  it("measures gravity rotation for rollover", () => {
    expect(gravityTiltDeg(gravityUp, { x: 0, y: 9.81, z: 0 })).toBeCloseTo(90, 5);
    expect(gravityTiltDeg(gravityUp, gravityUp)).toBeCloseTo(0, 5);
  });

  it("maps speed drop to front and rise to rear", () => {
    expect(
      classifyImpactDirection({ rollover: false, speedDeltaMps: -6, speedDeltaMin: 4 }),
    ).toBe("front");
    expect(
      classifyImpactDirection({ rollover: false, speedDeltaMps: 8, speedDeltaMin: 4 }),
    ).toBe("rear");
    expect(
      classifyImpactDirection({ rollover: true, speedDeltaMps: -6, speedDeltaMin: 4 }),
    ).toBe("rollover");
    expect(
      classifyImpactDirection({ rollover: false, speedDeltaMps: 1, speedDeltaMin: 4 }),
    ).toBe("unknown");
  });

  it("exposes host labels and a type guard", () => {
    expect(impactDirectionLabel("front")).toBe("Front");
    expect(impactDirectionLabel("unknown")).toBe("Direction unknown");
    expect(impactDirectionLabel(undefined)).toBe("Direction unknown");
    expect(isPossibleImpact({ type: "possible_impact" })).toBe(true);
    expect(isPossibleImpact({ type: "harsh_brake" })).toBe(false);
  });
});

describe("possible impact", () => {
  it("emits front when a short horizontal pulse is followed by a speed drop", () => {
    const session = runTrip({
      location: [loc(2000, 15), loc(4500, 5)],
      imu: [restImu(1800), ...horizontalPulse(3000), restImu(4000)],
      endedAtMs: 5000,
    });
    const event = session.events.find((item) => item.type === "possible_impact");
    expect(event).toBeDefined();
    expect(event?.impactDirection).toBe("front");
    expect(event?.overlaps).toEqual([]);
    expect(session.metrics.eventCounts.possible_impact).toBe(1);
  });

  it("ignores a long 4 g acceleration", () => {
    const imu: ImuSample[] = [restImu(1800)];
    for (let t = 3000; t <= 5000; t += 40) {
      imu.push(pulseImu(t, { x: 40, y: 0, z: 0 }));
    }
    imu.push(restImu(5040));
    const session = runTrip({
      location: [loc(2000, 15), loc(7000, 5)],
      imu,
      endedAtMs: 7500,
    });
    expect(session.events.some((item) => item.type === "possible_impact")).toBe(false);
  });

  it("ignores a vertical pothole with stable speed", () => {
    const session = runTrip({
      location: [loc(2000, 15), loc(4500, 15)],
      imu: [
        restImu(1800),
        pulseImu(3000, { x: 0, y: 0, z: 40 }),
        pulseImu(3040, { x: 0, y: 0, z: 40 }),
        pulseImu(3080, { x: 0, y: 0, z: 40 }),
        restImu(3120),
      ],
      endedAtMs: 5000,
    });
    expect(session.events.some((item) => item.type === "possible_impact")).toBe(false);
  });

  it("ignores a free-fall then spike (phone drop)", () => {
    const drop: ImuSample = {
      t: 2800,
      accel: { x: 0, y: 0, z: 0.4 },
      linearAccel: { x: 0, y: 0, z: 0 },
      gyro: null,
      magnetometer: null,
      attitude: null,
      gravity: gravityUp,
      barometerHpa: null,
    };
    const session = runTrip({
      location: [loc(2000, 15), loc(4500, 5)],
      imu: [restImu(1800), drop, { ...drop, t: 2900 }, ...horizontalPulse(3000)],
      endedAtMs: 5000,
    });
    expect(session.events.some((item) => item.type === "possible_impact")).toBe(false);
  });

  it("ignores a pulse inside the settle window", () => {
    const session = runTrip({
      location: [loc(200, 15), loc(2500, 5)],
      imu: [restImu(100), ...horizontalPulse(400)],
      endedAtMs: 3000,
    });
    expect(session.events.some((item) => item.type === "possible_impact")).toBe(false);
  });

  it("ignores a pulse while stopped", () => {
    const session = runTrip({
      location: [loc(2000, 0), loc(4500, 0)],
      imu: [restImu(1800), ...horizontalPulse(3000)],
      endedAtMs: 5000,
    });
    expect(session.events.some((item) => item.type === "possible_impact")).toBe(false);
  });

  it("emits unknown for a ~7 g pulse without a GPS speed change", () => {
    const session = runTrip({
      location: [loc(2000, 15), loc(4500, 15)],
      imu: [restImu(1800), ...horizontalPulse(3000, 70)],
      endedAtMs: 5000,
    });
    const event = session.events.find((item) => item.type === "possible_impact");
    expect(event?.impactDirection).toBe("unknown");
  });

  it("discards a 4 g pulse when speed does not change", () => {
    const session = runTrip({
      location: [loc(2000, 15), loc(5500, 15)],
      imu: [restImu(1800), ...horizontalPulse(3000)],
      endedAtMs: 6000,
    });
    expect(session.events.some((item) => item.type === "possible_impact")).toBe(false);
  });

  it("emits rear when speed rises after the pulse", () => {
    const session = runTrip({
      location: [loc(2000, 8), loc(4500, 18)],
      imu: [restImu(1800), ...horizontalPulse(3000)],
      endedAtMs: 5000,
    });
    expect(session.events.find((item) => item.type === "possible_impact")?.impactDirection).toBe(
      "rear",
    );
  });

  it("emits rollover when gravity rotates over the pulse", () => {
    const onSide: Vec3 = { x: 0, y: 9.81, z: 0 };
    const session = runTrip({
      location: [loc(2000, 15), loc(4500, 15)],
      imu: [
        restImu(1800),
        pulseImu(3000, { x: 40, y: 0, z: 0 }, gravityUp),
        pulseImu(3040, { x: 40, y: 0, z: 0 }, gravityUp),
        pulseImu(3080, { x: 40, y: 0, z: 0 }, onSide),
        pulseImu(3120, { x: 40, y: 0, z: 0 }, onSide),
        restImu(3160, onSide),
      ],
      endedAtMs: 5000,
    });
    expect(session.events.find((item) => item.type === "possible_impact")?.impactDirection).toBe(
      "rollover",
    );
  });

  it("does not change the trip score", () => {
    const location = [loc(2000, 15), loc(4500, 5)];
    const withImpact = runTrip({
      location,
      imu: [restImu(1800), ...horizontalPulse(3000)],
      endedAtMs: 5000,
    });
    const without = runTrip({
      location,
      imu: [restImu(1800), restImu(3000), restImu(4000)],
      endedAtMs: 5000,
    });
    expect(withImpact.events.some((item) => item.type === "possible_impact")).toBe(true);
    expect(withImpact.metrics.score).toBe(without.metrics.score);
    expect(
      scoreEvents(withImpact.events, withImpact.config, {
        distanceM: withImpact.metrics.distanceM,
        durationMs: withImpact.metrics.durationMs,
      }),
    ).toBe(
      scoreEvents(without.events, without.config, {
        distanceM: without.metrics.distanceM,
        durationMs: without.metrics.durationMs,
      }),
    );
  });

  it("does not band-upgrade a second pulse during impact cooldown", () => {
    const analyzer = createTripAnalyzer(quietConfig, {
      sessionId: "cooldown",
      startedAtMs: 0,
      device: { platform: "web", model: "test" },
    });
    analyzer.pushLocation(loc(2000, 15));
    for (const sample of [restImu(1800), ...horizontalPulse(3000)]) {
      analyzer.pushImu(sample);
    }
    analyzer.pushLocation(loc(4500, 5));
    expect(analyzer.getEvents().filter((item) => item.type === "possible_impact")).toHaveLength(1);

    for (const sample of horizontalPulse(5000, 70)) {
      analyzer.pushImu(sample);
    }
    analyzer.pushLocation(loc(7000, 1));
    expect(analyzer.getEvents().filter((item) => item.type === "possible_impact")).toHaveLength(1);
  });

  it("still detects at 25 Hz", () => {
    const session = runTrip({
      location: [loc(2000, 15), loc(4500, 5)],
      imu: [restImu(1800), ...horizontalPulse(3000)],
      endedAtMs: 5000,
    });
    expect(session.events.some((item) => item.type === "possible_impact")).toBe(true);
  });

  it("emits from the jolt alone when speed drop is 0", () => {
    const session = runTrip({
      location: [loc(2000, 15), loc(4500, 15)],
      imu: [restImu(1800), ...horizontalPulse(3000)],
      endedAtMs: 5000,
      config: { impactSpeedDeltaMps: 0 },
    });
    expect(session.events.find((item) => item.type === "possible_impact")?.impactDirection).toBe(
      "unknown",
    );
  });
});
