import { describe, expect, it } from "vitest";

import {
  POSSIBLE_IMPACT_TYPE,
  analyzeTrip,
  createHarshy,
  createMemoryJsonFileStore,
  createSimulatedEngine,
  impactDirectionLabel,
  isPossibleImpact,
  parseSessionExport,
  parseTripTrigger,
  shouldEndTrip,
  shouldStartTrip,
  trimIdleTailSamples,
  type DrivingEvent,
  type ImuSample,
  type LocationSample,
  type SensorEngine,
} from "./index";

const gravity = { x: 0, y: 0, z: 9.81 };

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

function restImu(t: number): ImuSample {
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

function pulseImu(t: number, peak = 40): ImuSample {
  return {
    t,
    accel: { x: peak, y: 0, z: 9.81 },
    linearAccel: { x: peak, y: 0, z: 0 },
    gyro: null,
    magnetometer: null,
    attitude: null,
    gravity,
    barometerHpa: null,
  };
}

function scriptedImpactEngine(): SensorEngine {
  let t0 = 0;
  let location: LocationSample[] = [];
  let imu: ImuSample[] = [];
  let locationHandler: ((sample: LocationSample) => void) | null = null;
  let imuHandler: ((sample: ImuSample) => void) | null = null;

  const load = (startedAtMs: number) => {
    t0 = startedAtMs;
    location = [loc(t0 + 2000, 15), loc(t0 + 4500, 5)];
    imu = [
      restImu(t0 + 1800),
      pulseImu(t0 + 3000),
      pulseImu(t0 + 3040),
      pulseImu(t0 + 3080),
      pulseImu(t0 + 3120),
      restImu(t0 + 3160),
    ];
  };

  return {
    kind: "simulated",
    getCapabilities: async () => ({
      location: true,
      accelerometer: true,
      linearAcceleration: true,
      gyroscope: false,
      magnetometer: false,
      barometer: false,
      attitude: false,
      backgroundLocation: false,
    }),
    getPermissionStatus: async () => ({
      location: "granted",
      backgroundLocation: "denied",
      motion: "granted",
      notifications: "granted",
    }),
    requestPermissions: async () => ({
      location: "granted",
      backgroundLocation: "denied",
      motion: "granted",
      notifications: "granted",
    }),
    start: async () => {
      load(Date.now());
      for (const sample of location) {
        locationHandler?.(sample);
      }
      for (const sample of imu) {
        imuHandler?.(sample);
      }
    },
    stop: async () => ({
      sessionId: "host-impact",
      startedAtMs: t0,
      endedAtMs: t0 + 5000,
      location,
      imu,
    }),
    isRunning: async () => false,
    getSnapshot: async () => ({
      sessionId: "host-impact",
      startedAtMs: t0,
      endedAtMs: t0 + 5000,
      location,
      imu,
    }),
    subscribe(listeners) {
      locationHandler = listeners.onLocation;
      imuHandler = listeners.onImu;
      return () => {
        locationHandler = null;
        imuHandler = null;
      };
    },
  };
}

describe("SDK host surface", () => {
  it("lets a host pin detector config on the client", () => {
    const client = createHarshy({
      nativeAvailable: false,
      detector: { impactPeakMps2: 42, impactSpeedDeltaMps: 6 },
    });
    expect(client.getDetectorConfig().impactPeakMps2).toBe(42);
    expect(client.getDetectorConfig().impactSpeedDeltaMps).toBe(6);
    expect(client.getDetectorConfig().harshBrakeMps2).toBeGreaterThan(0);
  });

  it("streams possible_impact through createHarshy without changing the score", async () => {
    const client = createHarshy({
      engine: scriptedImpactEngine(),
      nativeAvailable: false,
      detector: { harshAccelMps2: 50, harshBrakeMps2: 50, harshCornerMps2: 50 },
    });
    const seen: DrivingEvent[] = [];
    client.subscribe({
      onEvent: (event) => {
        seen.push(event);
      },
    });

    await client.start({ source: "simulated" });
    const session = await client.stop();
    const impact = session.events.find(isPossibleImpact);

    expect(impact?.type).toBe(POSSIBLE_IMPACT_TYPE);
    expect(impact?.impactDirection).toBe("front");
    expect(impactDirectionLabel(impact?.impactDirection)).toBe("Front");
    expect(session.metrics.score).toBe(100);
    expect(session.metrics.eventCounts.possible_impact).toBe(1);
    expect(seen.some(isPossibleImpact)).toBe(true);
    expect(parseSessionExport(session).sessionId).toBe(session.sessionId);
  });

  it("analyzes host-owned samples without a live engine", () => {
    const session = analyzeTrip({
      location: [loc(2000, 8), loc(4500, 18)],
      imu: [
        restImu(1800),
        pulseImu(3000),
        pulseImu(3040),
        pulseImu(3080),
        pulseImu(3120),
        restImu(3160),
      ],
      sessionId: "offline",
      startedAtMs: 0,
      endedAtMs: 5000,
      device: { platform: "unknown", model: null },
      config: { harshAccelMps2: 50, harshBrakeMps2: 50, harshCornerMps2: 50 },
    });
    const impact = session.events.find(isPossibleImpact);
    expect(impact?.impactDirection).toBe("rear");
    expect(session.metrics.score).toBe(100);
  });

  it("reloads compact history through the host barrel after a new createHarshy", async () => {
    const store = createMemoryJsonFileStore();
    const client = createHarshy({
      engine: createSimulatedEngine({ immediate: true }),
      nativeAvailable: false,
      historyStore: store,
    });
    await client.start({ source: "simulated" });
    const session = await client.stop();
    const reloaded = createHarshy({ nativeAvailable: false, historyStore: store });
    const history = await reloaded.loadHistory();
    expect(history[0]?.sessionId).toBe(session.sessionId);
    expect(history[0]?.imu).toEqual([]);
    expect(history).toHaveLength(1);
    expect(parseSessionExport(history[0]!).sessionId).toBe(session.sessionId);
  });

  it("re-exports auto-trip heuristic helpers for hosts", () => {
    expect(typeof shouldStartTrip).toBe("function");
    expect(typeof shouldEndTrip).toBe("function");
    expect(typeof parseTripTrigger).toBe("function");
    expect(typeof trimIdleTailSamples).toBe("function");
  });
});
