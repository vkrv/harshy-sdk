import { describe, expect, it } from "vitest";

import { analyzeTrip, scoreEvents } from "./detector.js";
import { isPhoneHandheld } from "./handheld.js";
import type { DetectorConfig, ImuSample, LocationSample, Vec3 } from "./types.js";

const gravityUp: Vec3 = { x: 0, y: 0, z: 9.81 };
const gravitySide: Vec3 = { x: 9.81, y: 0, z: 0 };

const quietConfig: Partial<DetectorConfig> = {
  harshAccelMps2: 50,
  harshBrakeMps2: 50,
  harshCornerMps2: 50,
  harshSwerveRadps: 50,
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

function imu(
  t: number,
  gravity: Vec3,
  opts?: { gyro?: Vec3 | null; linear?: Vec3 | null },
): ImuSample {
  const linear = opts?.linear ?? { x: 0, y: 0, z: 0 };
  return {
    t,
    accel: {
      x: linear.x + gravity.x,
      y: linear.y + gravity.y,
      z: linear.z + gravity.z,
    },
    linearAccel: linear,
    gyro: opts?.gyro ?? null,
    magnetometer: null,
    attitude: null,
    gravity,
    barometerHpa: null,
  };
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
    sessionId: "handheld",
    startedAtMs: 0,
    endedAtMs: args.endedAtMs,
    device: { platform: "web", model: "test" },
    config: { ...quietConfig, ...args.config },
  });
}

/** Quiet docked samples so the mount baseline locks. */
function dockQuiet(from: number, to: number, dt = 40): ImuSample[] {
  const samples: ImuSample[] = [];
  for (let t = from; t <= to; t += dt) {
    samples.push(imu(t, gravityUp));
  }
  return samples;
}

describe("phone_handheld", () => {
  it("exposes a type guard", () => {
    expect(isPhoneHandheld({ type: "phone_handheld" })).toBe(true);
    expect(isPhoneHandheld({ type: "possible_impact" })).toBe(false);
  });

  it("opens a span when the phone is picked up while moving", () => {
    const location = [loc(0, 12), loc(2000, 12), loc(4000, 12), loc(6000, 12)];
    const samples = [
      ...dockQuiet(0, 2000),
      // Pickup: gravity rotates + gyro spike, sustained past confirm.
      imu(2500, gravitySide, { gyro: { x: 0, y: 2, z: 0 } }),
      imu(2580, gravitySide, { gyro: { x: 0, y: 2, z: 0 } }),
      imu(2660, gravitySide, { gyro: { x: 0, y: 2, z: 0 } }),
      imu(2740, gravitySide, { gyro: { x: 0, y: 2, z: 0 } }),
      imu(2820, gravitySide, { gyro: { x: 0, y: 2, z: 0 } }),
      // Held still at new orientation.
      imu(3200, gravitySide),
      imu(3600, gravitySide),
      // Returned to mount.
      imu(4200, gravityUp),
      imu(4600, gravityUp),
      imu(5000, gravityUp),
      imu(5400, gravityUp),
    ];

    const session = runTrip({ imu: samples, location, endedAtMs: 6000 });
    const event = session.events.find(isPhoneHandheld);
    expect(event).toBeDefined();
    expect(event?.endT).not.toBeNull();
    expect(event!.peak).toBeGreaterThanOrEqual(35);
    expect(session.metrics.eventCounts.phone_handheld).toBe(1);
    expect(
      scoreEvents(session.events, session.config, {
        distanceM: session.metrics.distanceM,
        durationMs: session.metrics.durationMs,
      }),
    ).toBe(100);
  });

  it("does not emit while stopped", () => {
    const location = [loc(0, 0), loc(2000, 0), loc(4000, 0)];
    const samples = [
      ...dockQuiet(0, 2000),
      imu(2500, gravitySide, { gyro: { x: 0, y: 2, z: 0 } }),
      imu(2600, gravitySide, { gyro: { x: 0, y: 2, z: 0 } }),
      imu(2700, gravitySide, { gyro: { x: 0, y: 2, z: 0 } }),
      imu(2800, gravitySide, { gyro: { x: 0, y: 2, z: 0 } }),
      imu(3200, gravitySide),
    ];
    const session = runTrip({ imu: samples, location, endedAtMs: 4000 });
    expect(session.events.some(isPhoneHandheld)).toBe(false);
  });

  it("ignores the settle window after start", () => {
    const location = [loc(0, 12), loc(1000, 12)];
    const samples = [
      imu(0, gravityUp),
      imu(100, gravityUp),
      imu(200, gravitySide, { gyro: { x: 0, y: 2, z: 0 } }),
      imu(300, gravitySide, { gyro: { x: 0, y: 2, z: 0 } }),
      imu(400, gravitySide, { gyro: { x: 0, y: 2, z: 0 } }),
      imu(500, gravitySide, { gyro: { x: 0, y: 2, z: 0 } }),
      imu(800, gravitySide),
    ];
    const session = runTrip({
      imu: samples,
      location,
      endedAtMs: 1000,
      config: { jerkSettleMs: 1500 },
    });
    expect(session.events.some(isPhoneHandheld)).toBe(false);
  });

  it("does not treat a docked phone as handheld", () => {
    const location = [loc(0, 12), loc(3000, 12), loc(5000, 12)];
    const session = runTrip({
      imu: dockQuiet(0, 5000),
      location,
      endedAtMs: 5000,
    });
    expect(session.events.some(isPhoneHandheld)).toBe(false);
  });
});
