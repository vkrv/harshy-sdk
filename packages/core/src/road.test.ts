import { describe, expect, it } from "vitest";

import { DEFAULT_DETECTOR_CONFIG } from "./config.js";
import { analyzeTrip, createTripAnalyzer } from "./detector.js";
import { assessRoad, verticalLinearAccel } from "./road.js";
import { generateSampleTrip } from "./simulate.js";
import type { ImuSample, LocationSample } from "./types.js";

function loc(t: number, speedMps: number, roadRmsMps2?: number | null): LocationSample {
  return {
    t,
    lat: 32,
    lon: 34,
    altitudeM: null,
    speedMps,
    courseDeg: 0,
    accuracyM: 5,
    altitudeAccuracyM: null,
    ...(roadRmsMps2 !== undefined ? { roadRmsMps2 } : {}),
  };
}

function imu(t: number, linear: { x: number; y: number; z: number }, gravity?: { x: number; y: number; z: number }): ImuSample {
  return {
    t,
    accel: { x: linear.x, y: linear.y, z: linear.z + 9.81 },
    linearAccel: linear,
    gyro: null,
    magnetometer: null,
    attitude: null,
    gravity: gravity ?? { x: 0, y: 0, z: 9.81 },
    barometerHpa: null,
  };
}

describe("verticalLinearAccel", () => {
  it("projects onto gravity so phone-Z is not assumed up", () => {
    const onSide = imu(0, { x: 3.2, y: 0, z: 0 }, { x: 9.81, y: 0, z: 0 });
    expect(verticalLinearAccel(onSide)).toBeCloseTo(3.2, 5);
    expect(onSide.linearAccel?.z).toBe(0);
  });

  it("falls back to linearAccel.z when gravity is missing", () => {
    const sample = imu(0, { x: 1, y: 0, z: 2.5 });
    expect(verticalLinearAccel({ ...sample, gravity: null })).toBeCloseTo(2.5, 5);
  });

  it("subtracts gravity when only the full accel vector is present", () => {
    const sample: ImuSample = {
      t: 0,
      accel: { x: 0, y: 0, z: 11.81 },
      linearAccel: null,
      gyro: null,
      magnetometer: null,
      attitude: null,
      gravity: { x: 0, y: 0, z: 9.81 },
      barometerHpa: null,
    };
    expect(verticalLinearAccel(sample)).toBeCloseTo(2, 5);
  });
});

describe("assessRoad", () => {
  const startedAtMs = 1_000;
  const options = {
    startedAtMs,
    jerkSettleMs: DEFAULT_DETECTOR_CONFIG.jerkSettleMs,
    minSpeedMps: DEFAULT_DETECTOR_CONFIG.minSpeedMps,
  };

  it("ignores the settle window and idle speeds", () => {
    const location = [
      loc(startedAtMs + 400, 12),
      loc(startedAtMs + 3_000, 0.5),
      loc(startedAtMs + 4_000, 10),
    ];
    const samples = [
      imu(startedAtMs + 300, { x: 0, y: 0, z: 5 }),
      imu(startedAtMs + 2_800, { x: 0, y: 0, z: 5 }),
      imu(startedAtMs + 3_500, { x: 0, y: 0, z: 2 }),
      imu(startedAtMs + 4_000, { x: 0, y: 0, z: 2 }),
    ];
    const assessed = assessRoad(location, samples, options);
    expect(assessed[0]?.roadRmsMps2).toBeNull();
    expect(assessed[1]?.roadRmsMps2).toBeNull();
    expect(assessed[2]?.roadRmsMps2).toBeCloseTo(2, 5);
  });

  it("assigns 1 s RMS of world-up linear accel to each GPS sample", () => {
    const t = startedAtMs + 4_000;
    const location = [loc(t, 10)];
    const samples = [
      imu(t - 1_200, { x: 0, y: 0, z: 9 }),
      imu(t - 800, { x: 0, y: 0, z: 3 }),
      imu(t - 400, { x: 0, y: 0, z: 4 }),
      imu(t, { x: 0, y: 0, z: 0 }),
    ];
    const assessed = assessRoad(location, samples, options);
    const expected = Math.sqrt((9 + 16 + 0) / 3);
    expect(assessed[0]?.roadRmsMps2).toBeCloseTo(expected, 5);
  });

  it("keeps stored RMS when IMU was compacted away", () => {
    const location = [loc(startedAtMs + 4_000, 10, 1.4)];
    const assessed = assessRoad(location, [], options);
    expect(assessed[0]?.roadRmsMps2).toBe(1.4);
  });

  it("keeps native-stamped roadRms through live push when IMU is empty", () => {
    const analyzer = createTripAnalyzer(undefined, {
      sessionId: "native-road",
      startedAtMs,
      device: { platform: "android", model: "test" },
    });
    analyzer.pushLocation(loc(startedAtMs + 4_000, 12, 1.75));
    const session = analyzer.finalize(startedAtMs + 5_000);
    expect(session.imu).toEqual([]);
    expect(session.location[0]?.roadRmsMps2).toBe(1.75);
  });
});

describe("analyzeTrip road quality", () => {
  it("fills location.roadRmsMps2 without changing the driving score", () => {
    const trip = generateSampleTrip();
    const session = analyzeTrip({
      location: trip.location,
      imu: trip.imu,
      sessionId: trip.sessionId,
      startedAtMs: trip.startedAtMs,
      endedAtMs: trip.endedAtMs,
      device: { platform: "web", model: "sim" },
    });
    const withRoad = session.location.filter((sample) => sample.roadRmsMps2 != null);
    expect(withRoad.length).toBeGreaterThan(0);
    expect(Math.max(...withRoad.map((sample) => sample.roadRmsMps2 ?? 0))).toBeGreaterThan(2);
    expect(session.location[0]?.roadRmsMps2).toBeNull();

    const imuFlat = trip.imu.map((sample) => ({
      ...sample,
      linearAccel: sample.linearAccel
        ? { ...sample.linearAccel, z: 0.05 }
        : sample.linearAccel,
    }));
    const flat = analyzeTrip({
      location: trip.location,
      imu: imuFlat,
      sessionId: trip.sessionId,
      startedAtMs: trip.startedAtMs,
      endedAtMs: trip.endedAtMs,
      device: { platform: "web", model: "sim" },
    });
    expect(session.metrics.score).toBe(flat.metrics.score);
    expect(session.events.map((event) => event.type)).toEqual(flat.events.map((event) => event.type));
  });
});
