import { describe, expect, it } from "vitest";

import { DEFAULT_DETECTOR_CONFIG, SCORE_PENALTY_X } from "./config.js";
import { analyzeTrip, createTripAnalyzer, scoreEvents } from "./detector.js";
import { generateSampleTrip } from "./simulate.js";
import type { DrivingEvent, ImuSample, LocationSample } from "./types.js";

const brake: DrivingEvent = {
  id: "harsh_brake-1",
  type: "harsh_brake",
  t: 1,
  endT: null,
  peak: 5,
  severity: 1,
  level: "heavy",
  lat: null,
  lon: null,
  speedMps: 10,
  overlaps: [],
};

function loc(t: number, speedMps: number, courseDeg = 0): LocationSample {
  return {
    t,
    lat: 32,
    lon: 34 + t / 10_000_000,
    altitudeM: null,
    speedMps,
    courseDeg,
    accuracyM: 5,
    altitudeAccuracyM: null,
  };
}

function gyroYaw(t: number, z = 2): ImuSample {
  return {
    t,
    accel: { x: 0, y: 0, z: 9.8 },
    linearAccel: { x: 0, y: 0, z: 0 },
    gyro: { x: 0, y: 0, z },
    magnetometer: null,
    attitude: null,
    gravity: { x: 0, y: 0, z: 9.8 },
    barometerHpa: null,
  };
}

function imuSpike(t: number, mag = 8): ImuSample {
  return {
    t,
    accel: { x: 0, y: mag, z: 0 },
    linearAccel: { x: 0, y: mag, z: 0 },
    gyro: null,
    magnetometer: null,
    attitude: null,
    gravity: null,
    barometerHpa: null,
  };
}

describe("detector", () => {
  it("flags harsh brake, accel, and corner on the sample trip", () => {
    const trip = generateSampleTrip();
    const session = analyzeTrip({
      location: trip.location,
      imu: trip.imu,
      sessionId: trip.sessionId,
      startedAtMs: trip.startedAtMs,
      endedAtMs: trip.endedAtMs,
      device: { platform: "web", model: "sim" },
    });

    const types = new Set(session.events.map((event) => event.type));
    expect(types.has("harsh_brake")).toBe(true);
    expect(types.has("harsh_accel")).toBe(true);
    expect(types.has("harsh_corner")).toBe(true);
    expect(types.has("swerve")).toBe(true);
    expect(types.has("possible_impact")).toBe(false);
    expect(session.events.every((event) => ["light", "medium", "heavy"].includes(event.level))).toBe(
      true,
    );
    expect(session.metrics.score).toBeLessThan(100);
    expect(session.metrics.distanceM).toBeGreaterThan(100);
    expect(session.metrics.durationMs).toBeGreaterThan(50_000);
  });

  it("re-scores a recorded trip when thresholds change", () => {
    const trip = generateSampleTrip();
    const strict = analyzeTrip({
      location: trip.location,
      imu: trip.imu,
      sessionId: trip.sessionId,
      startedAtMs: trip.startedAtMs,
      endedAtMs: trip.endedAtMs,
      device: { platform: "web", model: "sim" },
      config: {
        harshAccelMps2: 1.2,
        harshBrakeMps2: 1.2,
        harshCornerMps2: 1.2,
      },
    });
    const loose = analyzeTrip({
      location: trip.location,
      imu: trip.imu,
      sessionId: trip.sessionId,
      startedAtMs: trip.startedAtMs,
      endedAtMs: trip.endedAtMs,
      device: { platform: "web", model: "sim" },
      config: {
        harshAccelMps2: 12,
        harshBrakeMps2: 12,
        harshCornerMps2: 12,
      },
    });

    expect(strict.events.length).toBeGreaterThan(loose.events.length);
    expect(strict.metrics.score).toBeLessThan(loose.metrics.score);
  });

  it("emits speeding spans that open and close around the cap", () => {
    const analyzer = createTripAnalyzer(
      { speedingMps: 10, harshAccelMps2: 20 },
      { sessionId: "span", startedAtMs: 0, device: { platform: "web", model: "test" } },
    );
    analyzer.pushLocation(loc(0, 8));
    const start = analyzer.pushLocation(loc(1000, 12));
    expect(start.newEvents.filter((event) => event.type === "speeding")).toHaveLength(1);
    expect(start.newEvents.find((event) => event.type === "speeding")?.endT).toBeNull();

    const peak = analyzer.pushLocation(loc(2000, 14));
    const speeding = peak.newEvents.find((event) => event.type === "speeding");
    expect(speeding?.peak).toBe(14);

    const closed = analyzer.pushLocation(loc(3000, 9));
    expect(closed.newEvents.find((event) => event.type === "speeding")?.endT).toBe(3000);
    expect(analyzer.getEvents().filter((event) => event.type === "speeding")).toHaveLength(1);
  });

  it("emits a swerve when yaw is harsh but lateral g is not a corner", () => {
    const analyzer = createTripAnalyzer(undefined, {
      sessionId: "swerve",
      startedAtMs: 0,
      device: { platform: "web", model: "test" },
    });
    analyzer.pushLocation(loc(0, 6, 0));
    const flick = analyzer.pushLocation(loc(1000, 6, 26));
    expect(flick.newEvents.some((event) => event.type === "swerve")).toBe(true);
    expect(flick.newEvents.some((event) => event.type === "harsh_corner")).toBe(false);
  });

  it("does not treat a handheld phone twist as a swerve", () => {
    const analyzer = createTripAnalyzer(undefined, {
      sessionId: "handheld",
      startedAtMs: 0,
      device: { platform: "web", model: "test" },
    });
    analyzer.pushLocation(loc(0, 0, 0));
    analyzer.pushLocation(loc(1000, 0, 90));
    const twist = analyzer.pushImu(gyroYaw(1100));
    expect(twist.newEvents.some((event) => event.type === "swerve")).toBe(false);
    expect(analyzer.getEvents().some((event) => event.type === "swerve")).toBe(false);
  });

  it("does not use phone gyro as vehicle yaw while GPS still shows motion", () => {
    const analyzer = createTripAnalyzer(undefined, {
      sessionId: "cup-holder",
      startedAtMs: 0,
      device: { platform: "web", model: "test" },
    });
    analyzer.pushLocation(loc(0, 6, 0));
    analyzer.pushLocation(loc(1000, 6, 0));
    const twist = analyzer.pushImu(gyroYaw(1100));
    expect(twist.newEvents.some((event) => event.type === "swerve")).toBe(false);
  });

  it("ignores GPS heading jumps below min speed", () => {
    const analyzer = createTripAnalyzer(undefined, {
      sessionId: "crawl",
      startedAtMs: 0,
      device: { platform: "web", model: "test" },
    });
    analyzer.pushLocation(loc(0, 1.5, 0));
    const jump = analyzer.pushLocation(loc(1000, 1.5, 90));
    expect(jump.newEvents.some((event) => event.type === "swerve")).toBe(false);
    expect(jump.metrics.swerveLevel).toBe("norm");
    expect(jump.metrics.headingDeg).toBeNull();
  });

  it("does not flash live heading from GPS course at rest", () => {
    const analyzer = createTripAnalyzer(undefined, {
      sessionId: "heading",
      startedAtMs: 0,
      device: { platform: "web", model: "test" },
    });
    expect(analyzer.pushLocation(loc(0, 0, 12)).metrics.headingDeg).toBeNull();
    expect(analyzer.pushLocation(loc(500, 0.5, 200)).metrics.headingDeg).toBeNull();
    analyzer.pushLocation(loc(1000, 6, 88));
    const locked = analyzer.pushLocation(loc(1500, 6, 90));
    expect(locked.metrics.headingDeg).toBeCloseTo(89, 0);
    const stopped = analyzer.pushLocation(loc(2000, 0, 15));
    expect(stopped.metrics.headingDeg).toBe(locked.metrics.headingDeg);
  });

  it("tags overlapping brake and corner as compound", () => {
    const analyzer = createTripAnalyzer(undefined, {
      sessionId: "compound",
      startedAtMs: 0,
      device: { platform: "web", model: "test" },
    });
    analyzer.pushLocation(loc(0, 12, 0));
    analyzer.pushLocation(loc(1000, 12, 0));
    const both = analyzer.pushLocation(loc(2000, 7, 45));
    const types = new Set(both.newEvents.map((event) => event.type));
    expect(types.has("harsh_brake")).toBe(true);
    expect(types.has("harsh_corner")).toBe(true);
    const brake = both.newEvents.find((event) => event.type === "harsh_brake");
    const corner = both.newEvents.find((event) => event.type === "harsh_corner");
    expect(brake?.overlaps).toContain("harsh_corner");
    expect(corner?.overlaps).toContain("harsh_brake");

    const tagged = scoreEvents(
      [brake!, corner!],
      DEFAULT_DETECTOR_CONFIG,
      { distanceM: 2_000, durationMs: 5 * 60_000 },
    );
    const plain = scoreEvents(
      [
        { ...brake!, overlaps: [] },
        { ...corner!, overlaps: [] },
      ],
      DEFAULT_DETECTOR_CONFIG,
      { distanceM: 2_000, durationMs: 5 * 60_000 },
    );
    expect(tagged).toBeLessThan(plain);
  });

  it("takes away one third of the event weight at the reference trip", () => {
    const score = scoreEvents([brake], DEFAULT_DETECTOR_CONFIG, {
      distanceM: 5_000,
      durationMs: 10 * 60_000,
    });
    expect(SCORE_PENALTY_X).toBe(1 / 3);
    expect(score).toBeCloseTo(100 - DEFAULT_DETECTOR_CONFIG.score.harshBrake * SCORE_PENALTY_X);
  });

  it("gives a perfect score when there are no events, regardless of trip length", () => {
    expect(
      scoreEvents([], DEFAULT_DETECTOR_CONFIG, { distanceM: 0, durationMs: 0 }),
    ).toBe(100);
    expect(
      scoreEvents([], DEFAULT_DETECTOR_CONFIG, { distanceM: 50_000, durationMs: 3_600_000 }),
    ).toBe(100);
  });

  it("penalizes the same events less on a longer, farther trip", () => {
    const events = [brake, brake];
    const short = scoreEvents(events, DEFAULT_DETECTOR_CONFIG, {
      distanceM: 2_000,
      durationMs: 5 * 60_000,
    });
    const long = scoreEvents(events, DEFAULT_DETECTOR_CONFIG, {
      distanceM: 40_000,
      durationMs: 40 * 60_000,
    });
    expect(short).toBeLessThan(100);
    expect(long).toBeGreaterThan(short);
    expect(long).toBeLessThanOrEqual(100);
  });

  it("uses both distance and duration when scaling penalties", () => {
    const events = [brake];
    const farQuick = scoreEvents(events, DEFAULT_DETECTOR_CONFIG, {
      distanceM: 40_000,
      durationMs: 5 * 60_000,
    });
    const nearSlow = scoreEvents(events, DEFAULT_DETECTOR_CONFIG, {
      distanceM: 2_000,
      durationMs: 40 * 60_000,
    });
    const farSlow = scoreEvents(events, DEFAULT_DETECTOR_CONFIG, {
      distanceM: 40_000,
      durationMs: 40 * 60_000,
    });
    expect(farSlow).toBeGreaterThan(farQuick);
    expect(farSlow).toBeGreaterThan(nearSlow);
  });

  it("tags live accel, brake, and corner as within norm or a harsh band", () => {
    const analyzer = createTripAnalyzer(undefined, {
      sessionId: "levels",
      startedAtMs: 0,
      device: { platform: "web", model: "test" },
    });
    analyzer.pushLocation(loc(0, 5));
    const cruise = analyzer.pushLocation(loc(1000, 5.1));
    expect(cruise.metrics.accelLevel).toBe("norm");
    expect(cruise.metrics.brakeLevel).toBe("norm");
    expect(cruise.metrics.cornerLevel).toBe("norm");

    const light = analyzer.pushLocation(loc(2000, 8));
    expect(light.metrics.accelLevel).toBe("light");
    expect(light.newEvents[0]?.type).toBe("harsh_accel");
    expect(light.newEvents[0]?.level).toBe("light");
  });

  it("upgrades a cooldown event when a higher band arrives", () => {
    const analyzer = createTripAnalyzer(undefined, {
      sessionId: "upgrade",
      startedAtMs: 0,
      device: { platform: "web", model: "test" },
    });
    analyzer.pushLocation(loc(0, 5));
    const light = analyzer.pushLocation(loc(1000, 7.6));
    expect(light.newEvents).toHaveLength(1);
    expect(light.newEvents[0]?.level).toBe("light");

    const heavy = analyzer.pushLocation(loc(1400, 13.6));
    expect(heavy.newEvents).toHaveLength(1);
    expect(heavy.newEvents[0]?.id).toBe(light.newEvents[0]?.id);
    expect(heavy.newEvents[0]?.level).toBe("heavy");
    expect(analyzer.getEvents()).toHaveLength(1);
  });

  it("merges same-type peaks a few seconds apart into one event", () => {
    const analyzer = createTripAnalyzer(
      { cooldownMs: 3500, compoundWindowMs: 3500 },
      {
        sessionId: "coalesce",
        startedAtMs: 0,
        device: { platform: "android", model: "test" },
      },
    );
    analyzer.pushLocation(loc(0, 5));
    const first = analyzer.pushLocation(loc(1000, 7.6));
    expect(first.newEvents).toHaveLength(1);
    const second = analyzer.pushLocation(loc(2500, 20));
    expect(second.newEvents).toHaveLength(1);
    expect(second.newEvents[0]?.id).toBe(first.newEvents[0]?.id);
    expect(second.newEvents[0]?.level).toBe("heavy");
    expect(analyzer.getEvents()).toHaveLength(1);
  });

  it("does not treat a start haptic IMU spike as jerk", () => {
    const analyzer = createTripAnalyzer(undefined, {
      sessionId: "haptic",
      startedAtMs: 1000,
      device: { platform: "web", model: "test" },
    });
    const tap = analyzer.pushImu(imuSpike(1020));
    expect(tap.newEvents.some((event) => event.type === "jerk")).toBe(false);

    const later = analyzer.pushImu(imuSpike(2600));
    expect(later.newEvents.some((event) => event.type === "jerk")).toBe(true);
  });

  it("does not record GPS teleports into the session", () => {
    const analyzer = createTripAnalyzer(undefined, {
      sessionId: "teleport",
      startedAtMs: 0,
      device: { platform: "android", model: "test" },
    });
    analyzer.pushLocation({
      t: 0,
      lat: 59.44803481455892,
      lon: 24.862493975088,
      altitudeM: null,
      speedMps: 4.42,
      courseDeg: 0,
      accuracyM: null,
      altitudeAccuracyM: null,
    });
    analyzer.pushLocation({
      t: 732,
      lat: 59.4395306,
      lon: 24.868772,
      altitudeM: null,
      speedMps: null,
      courseDeg: null,
      accuracyM: null,
      altitudeAccuracyM: null,
    });
    analyzer.pushLocation({
      t: 1000,
      lat: 59.448089925572276,
      lon: 24.862447874620557,
      altitudeM: null,
      speedMps: 8.6,
      courseDeg: 0,
      accuracyM: 5,
      altitudeAccuracyM: null,
    });
    const session = analyzer.finalize(2000);
    expect(session.location).toHaveLength(2);
    expect(session.location.some((sample) => sample.lat === 59.4395306)).toBe(false);
    expect(session.metrics.distanceM).toBeLessThan(50);
  });

  it("fills live heading and g-force when GNSS omits bearing", () => {
    const analyzer = createTripAnalyzer(undefined, {
      sessionId: "fused-course",
      startedAtMs: 0,
      device: { platform: "android", model: "test" },
    });
    const lonPerM = 1 / (111_320 * Math.cos((32 * Math.PI) / 180));
    const east = (t: number): LocationSample => ({
      t,
      lat: 32,
      lon: 34 + 8 * (t / 1000) * lonPerM,
      altitudeM: null,
      speedMps: 8,
      courseDeg: null,
      accuracyM: 8,
      altitudeAccuracyM: null,
    });
    let metrics = analyzer.pushLocation(east(0)).metrics;
    for (let t = 4000; t <= 16_000; t += 4000) {
      metrics = analyzer.pushLocation(east(t)).metrics;
    }
    expect(metrics.headingDeg).not.toBeNull();
    expect(metrics.headingDeg).toBeGreaterThan(80);
    expect(metrics.headingDeg).toBeLessThan(100);
    expect(metrics.longitudinalAccelMps2).not.toBeNull();
    expect(metrics.lateralAccelMps2).not.toBeNull();
  });

  it("records GNSS fixes that omit speed when accuracy is fine", () => {
    const analyzer = createTripAnalyzer(undefined, {
      sessionId: "gnss",
      startedAtMs: 0,
      device: { platform: "android", model: "test" },
    });
    analyzer.pushLocation(loc(0, 5));
    analyzer.pushLocation({
      t: 500,
      lat: 32,
      lon: 34 + 500 / 10_000_000,
      altitudeM: null,
      speedMps: null,
      courseDeg: null,
      accuracyM: 8,
      altitudeAccuracyM: null,
    });
    const session = analyzer.finalize(1000);
    expect(session.location).toHaveLength(2);
    expect(session.location[1]?.speedMps).not.toBeNull();
  });

  it("caps live sample rings and keeps early road RMS after IMU rolls off", () => {
    const analyzer = createTripAnalyzer(undefined, {
      sessionId: "ring",
      startedAtMs: 0,
      device: { platform: "web", model: "test" },
      imuHz: 1,
    });
    const bump = (t: number): ImuSample => ({
      t,
      accel: { x: 0, y: 0, z: 9.8 },
      linearAccel: { x: 0, y: 0, z: 4 },
      gyro: null,
      magnetometer: null,
      attitude: null,
      gravity: { x: 0, y: 0, z: 9.8 },
      barometerHpa: null,
    });
    for (let t = 2000; t < 2500; t += 50) {
      analyzer.pushImu(bump(t));
    }
    analyzer.pushLocation(loc(2200, 10));
    const mid = analyzer.finalize(2300);
    expect(mid.location[0]?.roadRmsMps2).toBeGreaterThan(1);

    // Overflow the 1 Hz × 120 min = 7200 sample IMU ring, then add a later GPS fix.
    for (let i = 0; i < 8_000; i += 1) {
      analyzer.pushImu(bump(10_000 + i));
    }
    analyzer.pushLocation(loc(20_000, 10));
    const session = analyzer.finalize(21_000);
    expect(session.imu.length).toBeLessThanOrEqual(7200);
    expect(session.location[0]?.roadRmsMps2).toBeGreaterThan(1);
  });
});
