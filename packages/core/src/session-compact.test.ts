import { describe, expect, it } from "vitest";

import { DEFAULT_DETECTOR_CONFIG } from "./config.js";
import { analyzeTrip } from "./detector.js";
import { parseSessionExport } from "./schemas.js";
import { compactLocationSample, compactSessionExport } from "./session-compact.js";
import { generateSampleTrip } from "./simulate.js";
import type { SessionExport } from "./types.js";

function sampleSession(): SessionExport {
  return {
    schemaVersion: 1,
    sessionId: "trip-1",
    startedAt: "2026-09-09T10:00:00.000Z",
    endedAt: "2026-09-09T10:05:00.000Z",
    config: DEFAULT_DETECTOR_CONFIG,
    location: [
      {
        t: 1,
        lat: 32,
        lon: 34,
        altitudeM: 10,
        speedMps: 10,
        courseDeg: 90,
        accuracyM: 5,
        altitudeAccuracyM: null,
        roadRmsMps2: 1.4,
      },
    ],
    imu: [
      {
        t: 1,
        accel: { x: 0, y: 0, z: 9.8 },
        linearAccel: null,
        gyro: null,
        magnetometer: null,
        attitude: null,
        gravity: null,
        barometerHpa: null,
      },
    ],
    events: [],
    metrics: {
      distanceM: 1200,
      durationMs: 300_000,
      maxSpeedMps: 14,
      avgSpeedMps: 10,
      score: 92,
      eventCounts: {
        harsh_accel: 0,
        harsh_brake: 1,
        harsh_corner: 0,
        swerve: 0,
        speeding: 0,
        jerk: 0,
        possible_impact: 0,
        phone_handheld: 0,
      },
    },
    device: { platform: "web", model: "test" },
  };
}

describe("session compact", () => {
  it("keeps speed, accuracy, and road RMS and drops IMU", () => {
    const session = sampleSession();
    const compact = compactSessionExport(session);
    expect(compact.imu).toEqual([]);
    expect(compact.location).toEqual([compactLocationSample(session.location[0]!)]);
    expect(compact.location[0]).toEqual({
      t: 1,
      lat: 32,
      lon: 34,
      altitudeM: null,
      speedMps: 10,
      courseDeg: null,
      accuracyM: 5,
      altitudeAccuracyM: null,
      roadRmsMps2: 1.4,
    });
    expect(parseSessionExport(compact).sessionId).toBe("trip-1");
  });

  it("compacts a fully analyzed sample trip without losing GPS points", () => {
    const trip = generateSampleTrip();
    const session = analyzeTrip({
      location: trip.location,
      imu: trip.imu,
      sessionId: trip.sessionId,
      startedAtMs: trip.startedAtMs,
      endedAtMs: trip.endedAtMs,
      device: { platform: "web", model: "sim" },
    });
    expect(session.imu.length).toBeGreaterThan(0);
    const compact = compactSessionExport(session);
    expect(compact.imu).toEqual([]);
    expect(compact.location.length).toBe(session.location.length);
    expect(compact.trigger).toBe("manual");
    expect(compact.location.map((sample) => sample.roadRmsMps2)).toEqual(
      session.location.map((sample) => sample.roadRmsMps2 ?? null),
    );
  });
});
