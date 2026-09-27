import { describe, expect, it } from "vitest";

import { DEFAULT_DETECTOR_CONFIG, SCORE_MAX, relativeScore } from "./config.js";
import { analyzeTrip, createTripAnalyzer, eventScorePoints, scoreEvents } from "./detector.js";
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

function destination(
  lat: number,
  lon: number,
  bearingDeg: number,
  distanceM: number,
): { lat: number; lon: number } {
  const earth = 6_371_000;
  const heading = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const ang = distanceM / earth;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(heading),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(heading) * Math.sin(ang) * Math.cos(lat1),
      Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: (lat2 * 180) / Math.PI, lon: (lon2 * 180) / Math.PI };
}

function placed(
  t: number,
  speedMps: number,
  courseDeg: number,
  lat: number,
  lon: number,
): LocationSample {
  return {
    t,
    lat,
    lon,
    altitudeM: null,
    speedMps,
    courseDeg,
    accuracyM: 4,
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
    expect(types.has("smooth_accel")).toBe(true);
    expect(types.has("smooth_brake")).toBe(true);
    expect(types.has("smooth_corner")).toBe(true);
    expect(types.has("possible_impact")).toBe(false);
    expect(session.events.every((event) => ["light", "medium", "heavy"].includes(event.level))).toBe(
      true,
    );
    expect(session.metrics.score).toBeLessThan(100);
    expect(session.metrics.distanceM).toBeGreaterThan(100);
    expect(session.metrics.durationMs).toBeGreaterThan(50_000);

    const sensitive = analyzeTrip({
      location: trip.location,
      imu: trip.imu,
      sessionId: trip.sessionId,
      startedAtMs: trip.startedAtMs,
      endedAtMs: trip.endedAtMs,
      device: { platform: "web", model: "sim" },
      config: {
        harshAccelMps2: 2,
        harshBrakeMps2: 2.5,
        harshCornerMps2: 2.5,
        minSpeedMps: 1.5,
        harshSwerveRadps: 0.35,
      },
    });
    const sensitiveTypes = new Set(sensitive.events.map((event) => event.type));
    expect(sensitiveTypes.has("smooth_accel")).toBe(true);
    expect(sensitiveTypes.has("smooth_brake")).toBe(true);
    expect(sensitiveTypes.has("smooth_corner")).toBe(true);
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
    expect(strict.metrics.score).toBeLessThanOrEqual(loose.metrics.score);
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
    const start = { lat: 59.46, lon: 24.82 };
    const mid = destination(start.lat, start.lon, 0, 6);
    const peak = destination(mid.lat, mid.lon, 26, 6);
    const settle = destination(peak.lat, peak.lon, 26, 6);
    analyzer.pushLocation(placed(0, 6, 0, start.lat, start.lon));
    analyzer.pushLocation(placed(1000, 6, 0, mid.lat, mid.lon));
    analyzer.pushLocation(placed(2000, 6, 26, peak.lat, peak.lon));
    const flick = analyzer.pushLocation(placed(3000, 6, 26, settle.lat, settle.lon));
    expect(flick.newEvents.some((event) => event.type === "swerve")).toBe(true);
    expect(analyzer.getEvents().some((event) => event.type === "harsh_corner")).toBe(false);
  });

  it("does not score a sustained low-speed turn as a swerve", () => {
    const analyzer = createTripAnalyzer(undefined, {
      sessionId: "steady-turn",
      startedAtMs: 0,
      device: { platform: "web", model: "test" },
    });
    let point = { lat: 59.46, lon: 24.82 };
    analyzer.pushLocation(placed(0, 6, 0, point.lat, point.lon));
    for (let i = 1; i <= 6; i += 1) {
      const course = i * 26;
      point = destination(point.lat, point.lon, course, 6);
      const step = analyzer.pushLocation(placed(i * 1000, 6, course, point.lat, point.lon));
      expect(step.newEvents.some((event) => event.type === "swerve")).toBe(false);
    }
    expect(analyzer.getEvents().some((event) => event.type === "swerve")).toBe(false);
  });

  it("does not score a sharp heading flick below swerve min speed", () => {
    const analyzer = createTripAnalyzer(undefined, {
      sessionId: "crawl-flick",
      startedAtMs: 0,
      device: { platform: "web", model: "test" },
    });
    const start = { lat: 59.46, lon: 24.82 };
    const mid = destination(start.lat, start.lon, 0, 3);
    const peak = destination(mid.lat, mid.lon, 26, 3);
    const settle = destination(peak.lat, peak.lon, 26, 3);
    analyzer.pushLocation(placed(0, 3, 0, start.lat, start.lon));
    analyzer.pushLocation(placed(1000, 3, 0, mid.lat, mid.lon));
    analyzer.pushLocation(placed(2000, 3, 26, peak.lat, peak.lon));
    const flick = analyzer.pushLocation(placed(3000, 3, 26, settle.lat, settle.lon));
    expect(flick.newEvents.some((event) => event.type === "swerve")).toBe(false);
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

  it("does not score a chip bearing that the straight road does not turn", () => {
    const analyzer = createTripAnalyzer(undefined, {
      sessionId: "straight-bearing",
      startedAtMs: 0,
      device: { platform: "android", model: "test" },
    });
    const start = { lat: 59.46078, lon: 24.81843 };
    const mid = destination(start.lat, start.lon, 240, 3);
    const end = destination(mid.lat, mid.lon, 244, 4.4);
    analyzer.pushLocation(placed(0, 0, 240, start.lat, start.lon));
    analyzer.pushLocation(placed(1000, 3.38, 240, mid.lat, mid.lon));
    analyzer.pushImu(gyroYaw(1500, 0.02));
    const glitch = analyzer.pushLocation(placed(2000, 4.44, 28, end.lat, end.lon));
    expect(glitch.newEvents.some((event) => event.type === "harsh_corner")).toBe(false);
    expect(glitch.newEvents.some((event) => event.type === "swerve")).toBe(false);
  });

  it("keeps a chip bearing the road rejects when the mounted phone is rotating with it", () => {
    const analyzer = createTripAnalyzer(undefined, {
      sessionId: "gyro-confirms",
      startedAtMs: 0,
      device: { platform: "android", model: "test" },
    });
    const start = { lat: 59.46078, lon: 24.81843 };
    const mid = destination(start.lat, start.lon, 240, 3);
    const end = destination(mid.lat, mid.lon, 244, 4.4);
    analyzer.pushLocation(placed(0, 0, 240, start.lat, start.lon));
    analyzer.pushLocation(placed(1000, 3.38, 240, mid.lat, mid.lon));
    analyzer.pushImu(gyroYaw(1500, 2.6));
    const confirmed = analyzer.pushLocation(placed(2000, 4.44, 28, end.lat, end.lon));
    expect(confirmed.newEvents.some((event) => event.type === "harsh_corner")).toBe(true);
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
    const start = { lat: 59.46, lon: 24.82 };
    const mid = destination(start.lat, start.lon, 0, 12);
    const end = destination(mid.lat, mid.lon, 45, 7);
    analyzer.pushLocation(placed(0, 12, 0, start.lat, start.lon));
    analyzer.pushLocation(placed(1000, 12, 0, mid.lat, mid.lon));
    const both = analyzer.pushLocation(placed(2000, 7, 45, end.lat, end.lon));
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
    expect(tagged).toBe(plain);
  });

  it("maps the absolute ledger to a relative 0–100 score by trip length", () => {
    expect(relativeScore(0)).toBe(100);
    expect(relativeScore(4)).toBe(100);
    // Reference distance (5 km): weight 1 → same as 100 + points.
    expect(relativeScore(-16, 5_000)).toBe(84);
    // Shorter trip (floored at min 2 km): weight 2.5 → harsher.
    expect(relativeScore(-16, 500)).toBe(60);
    expect(relativeScore(-16, 2_000)).toBe(60);
    // Longer trip: weight 0.5 floor → softer.
    expect(relativeScore(-16, 50_000)).toBe(92);
    expect(relativeScore(-100, 5_000)).toBe(0);
    expect(relativeScore(-200, 5_000)).toBe(0);
  });

  it("charges a heavy brake 16 points and can go negative", () => {
    expect(eventScorePoints(brake, DEFAULT_DETECTOR_CONFIG, 5_000)).toBe(-16);
    expect(
      scoreEvents([brake], DEFAULT_DETECTOR_CONFIG, { distanceM: 5_000, durationMs: 10 * 60_000 }),
    ).toBe(-16);
  });

  it("uses a fixed amount for each event", () => {
    expect(eventScorePoints({ ...brake, level: "light" }, DEFAULT_DETECTOR_CONFIG, 1_000)).toBe(-8);
    expect(eventScorePoints({ ...brake, level: "medium" }, DEFAULT_DETECTOR_CONFIG, 40_000)).toBe(-12);
    expect(eventScorePoints(brake, DEFAULT_DETECTOR_CONFIG, 1_000)).toBe(
      eventScorePoints(brake, DEFAULT_DETECTOR_CONFIG, 40_000),
    );
    expect(
      eventScorePoints({ ...brake, type: "possible_impact", overlaps: [] }, DEFAULT_DETECTOR_CONFIG, 5_000),
    ).toBe(0);
    expect(
      eventScorePoints({ ...brake, type: "speeding", overlaps: [] }, DEFAULT_DETECTOR_CONFIG, 5_000),
    ).toBe(0);
    expect(
      eventScorePoints({ ...brake, overlaps: ["harsh_corner"] }, DEFAULT_DETECTOR_CONFIG, 5_000),
    ).toBe(-16);
    expect(
      eventScorePoints({ ...brake, type: "smooth_accel", overlaps: [] }, DEFAULT_DETECTOR_CONFIG, 5_000),
    ).toBe(2);
    expect(
      eventScorePoints({ ...brake, type: "smooth_km", peak: 4, overlaps: [] }, DEFAULT_DETECTOR_CONFIG, 5_000),
    ).toBe(4);
    expect(
      eventScorePoints({ ...brake, type: "smooth_km", peak: 3, overlaps: [] }, DEFAULT_DETECTOR_CONFIG, 5_000),
    ).toBe(3);
  });

  it("starts at zero when there are no events", () => {
    expect(
      scoreEvents([], DEFAULT_DETECTOR_CONFIG, { distanceM: 0, durationMs: 0 }),
    ).toBe(0);
    expect(
      scoreEvents([], DEFAULT_DETECTOR_CONFIG, { distanceM: 50_000, durationMs: 3_600_000 }),
    ).toBe(0);
  });

  it("adds gentle credits and will not climb past 100", () => {
    const smooth: DrivingEvent = { ...brake, type: "smooth_accel", severity: 0, level: "light", overlaps: [] };
    expect(
      scoreEvents([smooth], DEFAULT_DETECTOR_CONFIG, { distanceM: 5_000, durationMs: 10 * 60_000 }),
    ).toBe(2);
    const pile = scoreEvents(
      Array.from({ length: 80 }, () => smooth),
      DEFAULT_DETECTOR_CONFIG,
      { distanceM: 5_000, durationMs: 10 * 60_000 },
    );
    expect(pile).toBe(SCORE_MAX);
  });

  it("records one gentle accel after it holds, then waits for more distance", () => {
    const analyzer = createTripAnalyzer(undefined, {
      sessionId: "smooth-accel",
      startedAtMs: 0,
      device: { platform: "web", model: "test" },
    });
    for (let step = 0; step <= 6; step += 1) {
      analyzer.pushLocation(loc(step * 1000, 10 + step));
    }
    const credits = analyzer.getEvents().filter((event) => event.type === "smooth_accel");
    expect(credits).toHaveLength(1);
    expect(credits[0]?.peak).toBeGreaterThanOrEqual(0.5);
    expect(credits[0]?.peak).toBeLessThanOrEqual(2.5 * 0.6);
    for (let step = 7; step <= 12; step += 1) {
      analyzer.pushLocation(loc(step * 1000, 10 + step));
    }
    expect(analyzer.getEvents().filter((event) => event.type === "smooth_accel")).toHaveLength(1);
    expect(analyzer.getMetrics().points).toBe(2);
    expect(analyzer.getMetrics().score).toBe(100);
  });

  it("pays 4 points when the first kilometre finishes clean", () => {
    const analyzer = createTripAnalyzer(undefined, {
      sessionId: "clean-km",
      startedAtMs: 0,
      device: { platform: "web", model: "test" },
    });
    let lat = 59.4;
    let lon = 24.8;
    analyzer.pushLocation(placed(0, 12, 0, lat, lon));
    for (let step = 1; step <= 90; step += 1) {
      const next = destination(lat, lon, 0, 12);
      lat = next.lat;
      lon = next.lon;
      analyzer.pushLocation(placed(step * 1000, 12, 0, lat, lon));
    }
    const kilometres = analyzer.getEvents().filter((event) => event.type === "smooth_km");
    expect(kilometres).toHaveLength(1);
    expect(kilometres[0]?.peak).toBe(4);
    expect(analyzer.getMetrics().points).toBe(4);
    expect(analyzer.getMetrics().score).toBe(100);
    expect(analyzer.getEvents().some((event) => event.type.startsWith("harsh_"))).toBe(false);
  });

  it("drops a gentle-accel hold when the pull gets harsh", () => {
    const analyzer = createTripAnalyzer(undefined, {
      sessionId: "smooth-reset",
      startedAtMs: 0,
      device: { platform: "web", model: "test" },
    });
    analyzer.pushLocation(loc(0, 10));
    analyzer.pushLocation(loc(1000, 11));
    analyzer.pushLocation(loc(2000, 12));
    analyzer.pushLocation(loc(3000, 20));
    analyzer.pushLocation(loc(4000, 21));
    analyzer.pushLocation(loc(5000, 22));
    analyzer.pushLocation(loc(6000, 23));
    expect(analyzer.getEvents().some((event) => event.type === "smooth_accel")).toBe(false);
  });

  it("ignores distance and duration when scoring the same events", () => {
    const events = [brake, { ...brake, id: "km", type: "smooth_km" as const, peak: 4, level: "light" as const }];
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
    expect(farQuick).toBe(-12);
    expect(nearSlow).toBe(farQuick);
    expect(farSlow).toBe(farQuick);
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

  it("does not treat a GPS speed spike as max speed", () => {
    const analyzer = createTripAnalyzer(undefined, {
      sessionId: "speed-spike",
      startedAtMs: 0,
      device: { platform: "android", model: "test" },
    });
    analyzer.pushLocation({
      t: 1_790_411_003_947,
      lat: 59.4104282,
      lon: 24.6768128,
      altitudeM: null,
      speedMps: 0.72,
      courseDeg: 0,
      accuracyM: 10.5,
      altitudeAccuracyM: null,
    });
    analyzer.pushLocation({
      t: 1_790_411_004_118,
      lat: 59.4104768,
      lon: 24.676784,
      altitudeM: null,
      speedMps: 33.01,
      courseDeg: 0,
      accuracyM: 15.9,
      altitudeAccuracyM: null,
    });
    analyzer.pushLocation({
      t: 1_790_411_004_676,
      lat: 59.4104289,
      lon: 24.6768066,
      altitudeM: null,
      speedMps: 0.64,
      courseDeg: 0,
      accuracyM: 10.7,
      altitudeAccuracyM: null,
    });
    const session = analyzer.finalize(1_790_411_005_000);
    expect(session.location).toHaveLength(2);
    expect(session.metrics.maxSpeedMps).not.toBeNull();
    expect(session.metrics.maxSpeedMps!).toBeLessThan(5);
  });

  it("drops a trailing speed leap that never gets a confirming fix", () => {
    const analyzer = createTripAnalyzer(undefined, {
      sessionId: "trailing-leap",
      startedAtMs: 0,
      device: { platform: "android", model: "test" },
    });
    analyzer.pushLocation({
      t: 1_790_411_003_947,
      lat: 59.4104282,
      lon: 24.6768128,
      altitudeM: null,
      speedMps: 0.72,
      courseDeg: 0,
      accuracyM: 10.5,
      altitudeAccuracyM: null,
    });
    analyzer.pushLocation({
      t: 1_790_411_004_118,
      lat: 59.4104768,
      lon: 24.676784,
      altitudeM: null,
      speedMps: 33.01,
      courseDeg: 0,
      accuracyM: 15.9,
      altitudeAccuracyM: null,
    });
    const session = analyzer.finalize(1_790_411_005_000);
    expect(session.location).toHaveLength(1);
    expect(session.metrics.maxSpeedMps!).toBeLessThan(5);
  });

  it("keeps a high speed when the next fix is still that fast", () => {
    const analyzer = createTripAnalyzer(undefined, {
      sessionId: "real-speed",
      startedAtMs: 0,
      device: { platform: "android", model: "test" },
    });
    analyzer.pushLocation({
      t: 0,
      lat: 59.4104282,
      lon: 24.6768128,
      altitudeM: null,
      speedMps: 0.72,
      courseDeg: 0,
      accuracyM: 8,
      altitudeAccuracyM: null,
    });
    const leap = analyzer.pushLocation({
      t: 1_000,
      lat: 59.4107,
      lon: 24.6768,
      altitudeM: null,
      speedMps: 33,
      courseDeg: 0,
      accuracyM: 8,
      altitudeAccuracyM: null,
    });
    expect(leap.metrics.speedMps ?? 0).toBeLessThan(5);
    const held = analyzer.pushLocation({
      t: 2_000,
      lat: 59.41097,
      lon: 24.6768,
      altitudeM: null,
      speedMps: 32,
      courseDeg: 0,
      accuracyM: 8,
      altitudeAccuracyM: null,
    });
    expect(held.metrics.speedMps ?? 0).toBeGreaterThan(30);
    const session = analyzer.finalize(3_000);
    expect(session.location).toHaveLength(3);
    expect(session.metrics.maxSpeedMps!).toBeGreaterThan(30);
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
