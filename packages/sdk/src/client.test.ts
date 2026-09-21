import { describe, expect, it } from "vitest";

import { createHarshy } from "./client";
import { createMemoryJsonFileStore } from "./json-file-store";
import { createSimulatedEngine } from "./simulated-engine";
import type { ImuSample, LocationSample, SensorEngine, WatchFix } from "./types";

function locSample(t: number, speedMps: number, lon: number): LocationSample {
  return {
    t,
    lat: 32.12345678,
    lon,
    altitudeM: null,
    speedMps,
    courseDeg: 90,
    accuracyM: 5,
    altitudeAccuracyM: null,
  };
}

function locPumpEngine(sessionId: string): {
  engine: SensorEngine;
  emit: (sample: LocationSample) => void;
} {
  let onLocation: ((sample: LocationSample) => void) | null = null;
  const granted = async () => ({
    location: "granted" as const,
    backgroundLocation: "granted" as const,
    motion: "granted" as const,
    notifications: "granted" as const,
  });
  const engine: SensorEngine = {
    kind: "simulated",
    getCapabilities: async () => ({
      location: true,
      accelerometer: false,
      linearAcceleration: false,
      gyroscope: false,
      magnetometer: false,
      barometer: false,
      attitude: false,
      backgroundLocation: false,
    }),
    getPermissionStatus: granted,
    requestPermissions: granted,
    start: async () => undefined,
    stop: async () => ({
      sessionId,
      startedAtMs: 1,
      endedAtMs: 2,
      location: [],
      imu: [],
    }),
    isRunning: async () => false,
    getSnapshot: async () => ({
      sessionId,
      startedAtMs: 1,
      endedAtMs: 2,
      location: [],
      imu: [],
    }),
    subscribe: (listeners) => {
      onLocation = listeners.onLocation;
      return () => {
        onLocation = null;
      };
    },
    armWatch: async () => undefined,
    disarmWatch: async () => undefined,
    subscribeWatch: () => () => {},
  };
  return {
    engine,
    emit: (sample) => {
      onLocation?.(sample);
    },
  };
}

describe("Harshy SDK", () => {
  it("forwards live location and IMU samples to subscribers", async () => {
    const client = createHarshy({
      engine: createSimulatedEngine({ immediate: true }),
      nativeAvailable: false,
    });

    let locations = 0;
    let imuSamples = 0;
    client.subscribe({
      onLocation: () => {
        locations += 1;
      },
      onImu: () => {
        imuSamples += 1;
      },
    });

    await client.start({ source: "simulated" });
    await client.stop();

    expect(locations).toBeGreaterThan(0);
    expect(imuSamples).toBeGreaterThan(0);
  });

  it("plays a simulated trip and exposes events plus a session export", async () => {
    const client = createHarshy({
      engine: createSimulatedEngine({ immediate: true }),
      nativeAvailable: false,
    });

    const events: string[] = [];
    let lastScore = 100;
    client.subscribe({
      onEvent: (event) => {
        events.push(event.type);
      },
      onMetrics: (metrics) => {
        lastScore = metrics.score;
      },
    });

    await client.start({ source: "simulated" });
    expect(client.getLiveLocation().length).toBeGreaterThan(0);
    const session = await client.stop();

    expect(session.schemaVersion).toBe(1);
    expect(session.location.length).toBeGreaterThan(0);
    expect(client.getLiveLocation()).toEqual([]);
    expect(session.metrics.distanceM).toBeGreaterThan(0);
    expect(lastScore).toBeLessThanOrEqual(100);
    expect(new Set(events).size).toBeGreaterThan(0);
  });

  it("retunes a recorded trip without collecting again", async () => {
    const client = createHarshy({
      engine: createSimulatedEngine({ immediate: true }),
      nativeAvailable: false,
    });
    await client.start({ source: "simulated" });
    await client.stop();

    const loose = client.retune({
      harshAccelMps2: 20,
      harshBrakeMps2: 20,
      harshCornerMps2: 20,
    });
    const strict = client.retune({
      harshAccelMps2: 1,
      harshBrakeMps2: 1,
      harshCornerMps2: 1,
    });

    expect(strict?.events.length ?? 0).toBeGreaterThan(loose?.events.length ?? 0);
  });

  it("uploads through a later-configured adapter", async () => {
    const client = createHarshy({
      engine: createSimulatedEngine({ immediate: true }),
      nativeAvailable: false,
    });
    await client.start({ source: "simulated" });
    const session = await client.stop();
    let received = "";
    client.setUploadAdapter({
      upload: async (payload) => {
        received = payload.sessionId;
      },
    });
    await client.upload(session);
    expect(received).toBe(session.sessionId);
  });

  it("does not stay running when the engine fails to start", async () => {
    const client = createHarshy({
      nativeAvailable: true,
      createNativeEngine: () => ({
        kind: "native",
        getCapabilities: async () => ({
          location: false,
          accelerometer: false,
          linearAcceleration: false,
          gyroscope: false,
          magnetometer: false,
          barometer: false,
          attitude: false,
          backgroundLocation: false,
        }),
        getPermissionStatus: async () => ({
          location: "denied",
          backgroundLocation: "denied",
          motion: "granted",
          notifications: "granted",
        }),
        requestPermissions: async () => ({
          location: "denied",
          backgroundLocation: "denied",
          motion: "granted",
          notifications: "granted",
        }),
        start: async () => {
          throw new Error("Location permission is required");
        },
        stop: async () => ({
          sessionId: null,
          startedAtMs: 0,
          endedAtMs: 0,
          location: [],
          imu: [],
        }),
        isRunning: async () => false,
        getSnapshot: async () => ({
          sessionId: null,
          startedAtMs: 0,
          endedAtMs: 0,
          location: [],
          imu: [],
        }),
        subscribe: () => () => {},
      }),
    });

    await expect(client.start({ source: "native" })).rejects.toThrow(
      "Location permission is required",
    );
    expect(client.getState().running).toBe(false);
  });

  it("attaches to a native trip that is still recording", async () => {
    const point = {
      t: 1,
      lat: 32,
      lon: 34,
      altitudeM: null,
      speedMps: 10,
      courseDeg: 90,
      accuracyM: 5,
      altitudeAccuracyM: null,
    };
    let started = false;
    const client = createHarshy({
      nativeAvailable: true,
      createNativeEngine: () => ({
        kind: "native",
        getCapabilities: async () => ({
          location: true,
          accelerometer: true,
          linearAcceleration: true,
          gyroscope: true,
          magnetometer: true,
          barometer: false,
          attitude: true,
          backgroundLocation: true,
        }),
        getPermissionStatus: async () => ({
          location: "granted",
          backgroundLocation: "granted",
          motion: "granted",
          notifications: "granted",
        }),
        requestPermissions: async () => ({
          location: "granted",
          backgroundLocation: "granted",
          motion: "granted",
          notifications: "granted",
        }),
        start: async () => {
          started = true;
        },
        stop: async () => ({
          sessionId: "alive",
          startedAtMs: 1,
          endedAtMs: 2,
          location: [point],
          imu: [],
        }),
        isRunning: async () => true,
        getSnapshot: async () => ({
          sessionId: "alive",
          startedAtMs: 1,
          endedAtMs: 2,
          location: [point],
          imu: [],
        }),
        subscribe: () => () => {},
      }),
    });

    expect(await client.recover({ device: { platform: "android", model: "test" } })).toBe(true);
    expect(client.getState().running).toBe(true);
    expect(client.getState().sessionId).toBe("alive");
    expect(client.getWatchState().trigger).toBe("manual");
    expect(started).toBe(false);
    expect(client.getLiveLocation()).toEqual([point]);
  });

  it("recover keeps trigger=auto from the native snapshot", async () => {
    const point = {
      t: 1,
      lat: 32,
      lon: 34,
      altitudeM: null,
      speedMps: 10,
      courseDeg: 90,
      accuracyM: 5,
      altitudeAccuracyM: null,
    };
    const client = createHarshy({
      nativeAvailable: true,
      createNativeEngine: () => ({
        kind: "native",
        getCapabilities: async () => ({
          location: true,
          accelerometer: true,
          linearAcceleration: true,
          gyroscope: true,
          magnetometer: true,
          barometer: false,
          attitude: true,
          backgroundLocation: true,
        }),
        getPermissionStatus: async () => ({
          location: "granted",
          backgroundLocation: "granted",
          motion: "granted",
          notifications: "granted",
        }),
        requestPermissions: async () => ({
          location: "granted",
          backgroundLocation: "granted",
          motion: "granted",
          notifications: "granted",
        }),
        start: async () => undefined,
        stop: async () => ({
          sessionId: "alive",
          startedAtMs: 1,
          endedAtMs: 2,
          location: [point],
          imu: [],
          trigger: "auto",
        }),
        isRunning: async () => true,
        getSnapshot: async () => ({
          sessionId: "alive",
          startedAtMs: 1,
          endedAtMs: 2,
          location: [point],
          imu: [],
          trigger: "auto",
        }),
        subscribe: () => () => {},
      }),
    });

    expect(await client.recover({ device: { platform: "android", model: "test" } })).toBe(true);
    expect(client.getWatchState().trigger).toBe("auto");
    expect(client.getWatchState().phase).toBe("warmup");
    expect(client.getWatchState().suppressed).toBe(false);
    const session = await client.stop();
    expect(session.trigger).toBe("auto");
  });

  it("recover of an auto trip already parked for 10 min auto-stops and trims the idle tail", async () => {
    const loc = (t: number, speedMps: number, lon: number): LocationSample => ({
      t,
      lat: 32.12345678,
      lon,
      altitudeM: null,
      speedMps,
      courseDeg: 90,
      accuracyM: 5,
      altitudeAccuracyM: null,
    });
    const startedAtMs = 1_000;
    const idleStart = startedAtMs + 60_000;
    const parked = idleStart + 600_000;
    const lon = (offsetMs: number) => 34.12345678 + offsetMs / 10_000_000;
    const journal = [
      loc(startedAtMs, 12, lon(0)),
      loc(startedAtMs + 30_000, 12, lon(30_000)),
      loc(idleStart, 0, lon(60_000)),
      loc(parked, 0, lon(60_000)),
    ];
    const client = createHarshy({
      nativeAvailable: true,
      createNativeEngine: () => ({
        kind: "native",
        getCapabilities: async () => ({
          location: true,
          accelerometer: true,
          linearAcceleration: true,
          gyroscope: true,
          magnetometer: true,
          barometer: false,
          attitude: true,
          backgroundLocation: true,
        }),
        getPermissionStatus: async () => ({
          location: "granted",
          backgroundLocation: "granted",
          motion: "granted",
          notifications: "granted",
        }),
        requestPermissions: async () => ({
          location: "granted",
          backgroundLocation: "granted",
          motion: "granted",
          notifications: "granted",
        }),
        start: async () => undefined,
        stop: async () => ({
          sessionId: "parked-auto",
          startedAtMs,
          endedAtMs: parked + 1_000,
          location: journal,
          imu: [],
          trigger: "auto",
        }),
        isRunning: async () => true,
        getSnapshot: async () => ({
          sessionId: "parked-auto",
          startedAtMs,
          endedAtMs: parked,
          location: journal,
          imu: [],
          trigger: "auto",
        }),
        subscribe: () => () => undefined,
      }),
    });

    expect(await client.recover({ device: { platform: "android", model: "test" } })).toBe(true);
    await expect.poll(() => client.getState().running).toBe(false);
    expect(client.getLastSession()?.trigger).toBe("auto");
    expect(client.getLastSession()?.location.every((sample) => sample.t <= idleStart)).toBe(true);
  });

  it("recover of an uncommitted parked warmup discards without saving", async () => {
    const startedAtMs = 1_000;
    const idleStart = startedAtMs + 3_000;
    const parked = idleStart + 30_000;
    const lon = (offsetMs: number) => 34.12345678 + offsetMs / 10_000_000;
    const journal = [
      locSample(startedAtMs, 12, lon(0)),
      locSample(idleStart, 0, lon(3_000)),
      locSample(parked, 0, lon(3_000)),
    ];
    const client = createHarshy({
      nativeAvailable: true,
      createNativeEngine: () => ({
        kind: "native",
        getCapabilities: async () => ({
          location: true,
          accelerometer: true,
          linearAcceleration: true,
          gyroscope: true,
          magnetometer: true,
          barometer: false,
          attitude: true,
          backgroundLocation: true,
        }),
        getPermissionStatus: async () => ({
          location: "granted",
          backgroundLocation: "granted",
          motion: "granted",
          notifications: "granted",
        }),
        requestPermissions: async () => ({
          location: "granted",
          backgroundLocation: "granted",
          motion: "granted",
          notifications: "granted",
        }),
        start: async () => undefined,
        stop: async () => ({
          sessionId: "warmup-abort",
          startedAtMs,
          endedAtMs: parked + 1_000,
          location: journal,
          imu: [],
          trigger: "auto",
        }),
        isRunning: async () => true,
        getSnapshot: async () => ({
          sessionId: "warmup-abort",
          startedAtMs,
          endedAtMs: parked,
          location: journal,
          imu: [],
          trigger: "auto",
        }),
        subscribe: () => () => undefined,
      }),
    });

    expect(await client.recover({ device: { platform: "android", model: "test" } })).toBe(true);
    await expect.poll(() => client.getState().running).toBe(false);
    expect(client.getLastSession()).toBeNull();
  });

  it("recover ends an auto trip after a long GPS silence that resumes parked", async () => {
    const loc = (t: number, speedMps: number, lon: number): LocationSample => ({
      t,
      lat: 32.12345678,
      lon,
      altitudeM: null,
      speedMps,
      courseDeg: 90,
      accuracyM: 5,
      altitudeAccuracyM: null,
    });
    const startedAtMs = 1_000;
    const lastMoving = startedAtMs + 60_000;
    const resumed = lastMoving + 600_000;
    const lon = (offsetMs: number) => 34.12345678 + offsetMs / 10_000_000;
    const journal = [
      loc(startedAtMs, 12, lon(0)),
      loc(lastMoving, 11, lon(60_000)),
      loc(resumed, 0.4, lon(60_000) + 0.0003),
    ];
    const client = createHarshy({
      nativeAvailable: true,
      createNativeEngine: () => ({
        kind: "native",
        getCapabilities: async () => ({
          location: true,
          accelerometer: true,
          linearAcceleration: true,
          gyroscope: true,
          magnetometer: true,
          barometer: false,
          attitude: true,
          backgroundLocation: true,
        }),
        getPermissionStatus: async () => ({
          location: "granted",
          backgroundLocation: "granted",
          motion: "granted",
          notifications: "granted",
        }),
        requestPermissions: async () => ({
          location: "granted",
          backgroundLocation: "granted",
          motion: "granted",
          notifications: "granted",
        }),
        start: async () => undefined,
        stop: async () => ({
          sessionId: "silence-auto",
          startedAtMs,
          endedAtMs: resumed + 1_000,
          location: journal,
          imu: [],
          trigger: "auto",
        }),
        isRunning: async () => true,
        getSnapshot: async () => ({
          sessionId: "silence-auto",
          startedAtMs,
          endedAtMs: resumed,
          location: journal,
          imu: [],
          trigger: "auto",
        }),
        subscribe: () => () => undefined,
      }),
    });

    expect(await client.recover({ device: { platform: "android", model: "test" } })).toBe(true);
    await expect.poll(() => client.getState().running).toBe(false);
    expect(client.getLastSession()?.trigger).toBe("auto");
    expect(client.getLastSession()?.location.every((sample) => sample.t <= lastMoving)).toBe(true);
    expect(client.getLastSession()?.location.some((sample) => sample.t === lastMoving)).toBe(true);
  });

  it("passes trigger through to native start", async () => {
    const point = {
      t: 1,
      lat: 32,
      lon: 34,
      altitudeM: null,
      speedMps: 10,
      courseDeg: 90,
      accuracyM: 5,
      altitudeAccuracyM: null,
    };
    let startedTrigger: string | undefined;
    const client = createHarshy({
      nativeAvailable: true,
      createNativeEngine: () => ({
        kind: "native",
        getCapabilities: async () => ({
          location: true,
          accelerometer: true,
          linearAcceleration: true,
          gyroscope: true,
          magnetometer: true,
          barometer: false,
          attitude: true,
          backgroundLocation: true,
        }),
        getPermissionStatus: async () => ({
          location: "granted",
          backgroundLocation: "granted",
          motion: "granted",
          notifications: "granted",
        }),
        requestPermissions: async () => ({
          location: "granted",
          backgroundLocation: "granted",
          motion: "granted",
          notifications: "granted",
        }),
        start: async (native) => {
          startedTrigger = native.trigger;
        },
        stop: async () => ({
          sessionId: "n1",
          startedAtMs: 1,
          endedAtMs: 2,
          location: [point],
          imu: [],
          trigger: startedTrigger ?? "manual",
        }),
        isRunning: async () => false,
        getSnapshot: async () => ({
          sessionId: null,
          startedAtMs: 0,
          endedAtMs: 0,
          location: [],
          imu: [],
        }),
        subscribe: () => () => {},
      }),
    });

    await client.start({ trigger: "auto", device: { platform: "android", model: "test" } });
    expect(startedTrigger).toBe("auto");
    expect(client.getWatchState().trigger).toBe("auto");
  });

  it("start attaches to a live native trip and re-issues start so GPS stays registered", async () => {
    const point = {
      t: 1,
      lat: 32,
      lon: 34,
      altitudeM: null,
      speedMps: 10,
      courseDeg: 90,
      accuracyM: 5,
      altitudeAccuracyM: null,
    };
    let started = 0;
    const client = createHarshy({
      nativeAvailable: true,
      createNativeEngine: () => ({
        kind: "native",
        getCapabilities: async () => ({
          location: true,
          accelerometer: true,
          linearAcceleration: true,
          gyroscope: true,
          magnetometer: true,
          barometer: false,
          attitude: true,
          backgroundLocation: true,
        }),
        getPermissionStatus: async () => ({
          location: "granted",
          backgroundLocation: "granted",
          motion: "granted",
          notifications: "granted",
        }),
        requestPermissions: async () => ({
          location: "granted",
          backgroundLocation: "granted",
          motion: "granted",
          notifications: "granted",
        }),
        start: async () => {
          started += 1;
        },
        stop: async () => ({
          sessionId: "alive",
          startedAtMs: 1,
          endedAtMs: 2,
          location: [point],
          imu: [],
        }),
        isRunning: async () => true,
        getSnapshot: async () => ({
          sessionId: "alive",
          startedAtMs: 1,
          endedAtMs: 2,
          location: [point],
          imu: [],
        }),
        subscribe: () => () => {},
      }),
    });

    await client.start({
      source: "native",
      device: { platform: "android", model: "test" },
    });
    expect(started).toBe(1);
    expect(client.getState().running).toBe(true);
    expect(client.getState().sessionId).toBe("alive");
  });

  it("persists a compact session so a new client can reload history", async () => {
    const store = createMemoryJsonFileStore();
    const client = createHarshy({
      engine: createSimulatedEngine({ immediate: true }),
      nativeAvailable: false,
      historyStore: store,
    });
    await client.start({ source: "simulated" });
    const session = await client.stop();
    expect(session.imu.length).toBeGreaterThan(0);
    expect(client.getHistory()[0]?.sessionId).toBe(session.sessionId);
    expect(client.getHistory()[0]?.imu).toEqual([]);

    const reloaded = createHarshy({
      engine: createSimulatedEngine({ immediate: true }),
      nativeAvailable: false,
      historyStore: store,
    });
    const history = await reloaded.loadHistory();
    expect(history.map((item) => item.sessionId)).toEqual([session.sessionId]);
    expect(history[0]?.imu).toEqual([]);
    expect(history[0]?.location.length).toBe(session.location.length);
  });

  it("updates the stored session when retune runs after stop", async () => {
    const store = createMemoryJsonFileStore();
    const client = createHarshy({
      engine: createSimulatedEngine({ immediate: true }),
      nativeAvailable: false,
      historyStore: store,
    });
    await client.start({ source: "simulated" });
    await client.stop();
    const strict = client.retune({
      harshAccelMps2: 1,
      harshBrakeMps2: 1,
      harshCornerMps2: 1,
    });
    await client.flushHistory();

    const reloaded = createHarshy({
      nativeAvailable: false,
      historyStore: store,
    });
    const history = await reloaded.loadHistory();
    expect(history[0]?.sessionId).toBe(strict?.sessionId);
    expect(history[0]?.events.length).toBe(strict?.events.length);
    expect(history[0]?.config.harshAccelMps2).toBe(1);
  });

  it("surfaces a persist failure from stop without dropping lastSession", async () => {
    const inner = createMemoryJsonFileStore();
    const store = {
      read: inner.read,
      list: inner.list,
      remove: inner.remove,
      write: async () => {
        throw new Error("disk full");
      },
    };
    const client = createHarshy({
      engine: createSimulatedEngine({ immediate: true }),
      nativeAvailable: false,
      historyStore: store,
    });
    const errors: string[] = [];
    client.subscribe({
      onError: (error) => {
        errors.push(`${error.code}:${error.message}`);
      },
    });
    await client.start({ source: "simulated" });
    await expect(client.stop()).rejects.toThrow("disk full");
    expect(client.getLastSession()?.location.length).toBeGreaterThan(0);
    expect(errors.some((item) => item.startsWith("persist:"))).toBe(true);
  });

  it("records trigger=manual on a host start/stop and stays disarmed", async () => {
    const client = createHarshy({
      engine: createSimulatedEngine({ immediate: true }),
      nativeAvailable: false,
    });
    expect(client.getWatchState()).toEqual({
      mode: "manual",
      phase: "disarmed",
      trigger: null,
      suppressed: false,
      nativeWatch: false,
      lastFix: null,
      startHoldMs: 0,
      startDistanceM: 0,
    });
    await client.start({ source: "simulated" });
    expect(client.getWatchState().phase).toBe("recording");
    expect(client.getWatchState().trigger).toBe("manual");
    const session = await client.stop();
    expect(session.trigger).toBe("manual");
    expect(client.getWatchState().phase).toBe("disarmed");
  });

  it("arms Auto mode, suppresses on manual start, and re-arms after stop", async () => {
    const client = createHarshy({
      engine: createSimulatedEngine({ immediate: true }),
      nativeAvailable: false,
    });
    await client.arm();
    expect(client.getWatchState()).toMatchObject({
      mode: "auto",
      phase: "armed",
      trigger: null,
      suppressed: false,
      nativeWatch: false,
    });
    await client.start({ source: "simulated" });
    expect(client.getWatchState()).toMatchObject({
      mode: "auto",
      phase: "recording",
      trigger: "manual",
      suppressed: true,
    });
    const session = await client.stop();
    expect(session.trigger).toBe("manual");
    expect(client.getWatchState()).toMatchObject({
      mode: "auto",
      phase: "armed",
      trigger: null,
      suppressed: false,
    });
  });

  it("disarm during a trip does not stop capture", async () => {
    const client = createHarshy({
      engine: createSimulatedEngine({ immediate: true }),
      nativeAvailable: false,
    });
    await client.start({ source: "simulated" });
    await client.arm();
    expect(client.getWatchState().suppressed).toBe(true);
    await client.disarm();
    expect(client.getState().running).toBe(true);
    expect(client.getWatchState()).toMatchObject({
      mode: "manual",
      phase: "recording",
      trigger: "manual",
      suppressed: false,
    });
    await client.stop();
    expect(client.getWatchState().phase).toBe("disarmed");
  });

  it("auto-starts through existing start() when the watch heuristic fires", async () => {
    let onFix: ((fix: WatchFix) => void) | null = null;
    let started = 0;
    const engine: SensorEngine = {
      kind: "simulated",
      getCapabilities: async () => ({
        location: true,
        accelerometer: false,
        linearAcceleration: false,
        gyroscope: false,
        magnetometer: false,
        barometer: false,
        attitude: false,
        backgroundLocation: false,
      }),
      getPermissionStatus: async () => ({
        location: "granted",
        backgroundLocation: "granted",
        motion: "granted",
        notifications: "granted",
      }),
      requestPermissions: async () => ({
        location: "granted",
        backgroundLocation: "granted",
        motion: "granted",
        notifications: "granted",
      }),
      start: async () => {
        started += 1;
      },
      stop: async () => ({
        sessionId: "auto",
        startedAtMs: 1,
        endedAtMs: 2,
        location: [],
        imu: [],
      }),
      isRunning: async () => false,
      getSnapshot: async () => ({
        sessionId: "auto",
        startedAtMs: 1,
        endedAtMs: 2,
        location: [],
        imu: [],
      }),
      subscribe: () => () => {},
      armWatch: async () => {},
      disarmWatch: async () => {},
      subscribeWatch: (listeners) => {
        onFix = listeners.onFix;
        return () => {
          onFix = null;
        };
      },
    };
    const client = createHarshy({ engine, nativeAvailable: false });
    await client.arm({
      heuristic: { startHoldMs: 1000, startDistanceM: 20, startSpeedMps: 5 },
    });
    expect(client.getWatchState().nativeWatch).toBe(true);
    expect(client.getWatchState().phase).toBe("armed");

    const emit = (t: number, lon: number) => {
      onFix?.({
        t,
        lat: 32,
        lon,
        speedMps: 10,
        accuracyM: 5,
        activity: "automotive",
      });
    };
    emit(0, 34);
    emit(500, 34.00005);
    expect(client.getState().running).toBe(false);
    expect(client.getWatchState().lastFix?.activity).toBe("automotive");
    expect(client.getWatchState().startHoldMs).toBe(500);
    expect(client.getWatchState().startDistanceM).toBeGreaterThan(0);
    emit(1200, 34.0004);
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(started).toBe(1);
    expect(client.getState().running).toBe(true);
    expect(client.getWatchState()).toMatchObject({
      phase: "warmup",
      trigger: "auto",
      suppressed: false,
      mode: "auto",
    });
    const session = await client.stop();
    expect(session.trigger).toBe("auto");
    expect(client.getWatchState().phase).toBe("armed");
  });

  it("auto start is warmup until trip GPS meets commit gates", async () => {
    const { engine, emit } = locPumpEngine("warmup-commit");
    const client = createHarshy({ engine, nativeAvailable: false });
    await client.start({ trigger: "auto" });
    expect(client.getWatchState().phase).toBe("warmup");
    const startedAtMs = client.getState().startedAtMs!;
    emit(locSample(startedAtMs, 12, 34.0));
    emit(locSample(startedAtMs + 10_000, 12, 34.001));
    expect(client.getWatchState().phase).toBe("warmup");
    emit(locSample(startedAtMs + 20_000, 12, 34.002));
    expect(client.getWatchState().phase).toBe("recording");
    expect(client.getState().running).toBe(true);
  });

  it("aborts warmup after 30 s parked, discards, and re-arms", async () => {
    const { engine, emit } = locPumpEngine("warmup-discard");
    const client = createHarshy({ engine, nativeAvailable: false });
    await client.start({ trigger: "manual" });
    const previous = await client.stop();
    await client.arm();
    await client.start({ trigger: "auto" });
    expect(client.getWatchState().phase).toBe("warmup");
    const startedAtMs = client.getState().startedAtMs!;
    emit(locSample(startedAtMs, 12, 34.0));
    emit(locSample(startedAtMs + 2_000, 0, 34.0001));
    emit(locSample(startedAtMs + 31_999, 0, 34.0001));
    expect(client.getState().running).toBe(true);
    emit(locSample(startedAtMs + 32_000, 0, 34.0001));
    await expect.poll(() => client.getState().running).toBe(false);
    expect(client.getLastSession()?.sessionId).toBe(previous.sessionId);
    expect(client.getWatchState()).toMatchObject({
      mode: "auto",
      phase: "armed",
      trigger: null,
    });
  });

  it("auto-stops after 10 min parked and drops that idle tail from the session", async () => {
    let onLocation: ((sample: LocationSample) => void) | null = null;
    let onImu: ((sample: ImuSample) => void) | null = null;
    let stopEndedAt = 0;
    const granted = async () => ({
      location: "granted" as const,
      backgroundLocation: "granted" as const,
      motion: "granted" as const,
      notifications: "granted" as const,
    });
    const engine: SensorEngine = {
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
      getPermissionStatus: granted,
      requestPermissions: granted,
      start: async () => undefined,
      stop: async () => ({
        sessionId: "auto-end",
        startedAtMs: 1,
        endedAtMs: stopEndedAt,
        location: [],
        imu: [],
      }),
      isRunning: async () => false,
      getSnapshot: async () => ({
        sessionId: "auto-end",
        startedAtMs: 1,
        endedAtMs: stopEndedAt,
        location: [],
        imu: [],
      }),
      subscribe: (listeners) => {
        onLocation = listeners.onLocation;
        onImu = listeners.onImu;
        return () => {
          onLocation = null;
          onImu = null;
        };
      },
    };
    const loc = (t: number, speedMps: number, lon: number): LocationSample => ({
      t,
      lat: 32.12345678,
      lon,
      altitudeM: null,
      speedMps,
      courseDeg: 90,
      accuracyM: 5,
      altitudeAccuracyM: null,
    });
    const imuAt = (t: number): ImuSample => ({
      t,
      accel: { x: 0, y: 0, z: 9.8 },
      linearAccel: { x: 0, y: 0, z: 0 },
      gyro: null,
      magnetometer: null,
      attitude: null,
      gravity: { x: 0, y: 0, z: 9.8 },
      barometerHpa: null,
    });
    const client = createHarshy({ engine, nativeAvailable: false });
    await client.start({ trigger: "auto" });
    expect(client.getWatchState().phase).toBe("warmup");
    const startedAtMs = client.getState().startedAtMs!;
    const driveMs = 60_000;
    const idleStart = startedAtMs + driveMs;
    const holdMs = 600_000;
    stopEndedAt = idleStart + holdMs;
    const lon = (offsetMs: number) => 34.12345678 + offsetMs / 10_000_000;
    onLocation?.(loc(startedAtMs, 12, lon(0)));
    onImu?.(imuAt(startedAtMs + 10));
    onLocation?.(loc(startedAtMs + 30_000, 12, lon(30_000)));
    expect(client.getWatchState().phase).toBe("recording");
    onLocation?.(loc(idleStart, 0, lon(driveMs)));
    onImu?.(imuAt(idleStart + 1_000));
    onLocation?.(loc(idleStart + 180_000, 0, lon(driveMs)));
    expect(client.getState().running).toBe(true);
    onLocation?.(loc(idleStart + holdMs, 0, lon(driveMs)));
    await expect.poll(() => client.getLastSession()?.trigger).toBe("auto");
    expect(client.getState().running).toBe(false);
    const session = client.getLastSession();
    expect(session?.trigger).toBe("auto");
    expect(session?.metrics.durationMs).toBe(driveMs);
    expect(session?.location.every((sample) => sample.t <= idleStart)).toBe(true);
    expect(session?.imu.every((sample) => sample.t <= idleStart)).toBe(true);
    expect(session?.location.some((sample) => sample.t === idleStart)).toBe(true);
    expect(session?.location.some((sample) => sample.t === idleStart + holdMs)).toBe(false);
    expect(session?.imu.some((sample) => sample.t === startedAtMs + 10)).toBe(true);
    expect(session?.imu.some((sample) => sample.t === idleStart + 1_000)).toBe(false);
  });

  it("keeps the parked tail when the host stops a manual trip", async () => {
    let onLocation: ((sample: LocationSample) => void) | null = null;
    let stopEndedAt = 0;
    const granted = async () => ({
      location: "granted" as const,
      backgroundLocation: "granted" as const,
      motion: "granted" as const,
      notifications: "granted" as const,
    });
    const engine: SensorEngine = {
      kind: "simulated",
      getCapabilities: async () => ({
        location: true,
        accelerometer: false,
        linearAcceleration: false,
        gyroscope: false,
        magnetometer: false,
        barometer: false,
        attitude: false,
        backgroundLocation: false,
      }),
      getPermissionStatus: granted,
      requestPermissions: granted,
      start: async () => undefined,
      stop: async () => ({
        sessionId: "manual-end",
        startedAtMs: 1,
        endedAtMs: stopEndedAt,
        location: [],
        imu: [],
      }),
      isRunning: async () => false,
      getSnapshot: async () => ({
        sessionId: "manual-end",
        startedAtMs: 1,
        endedAtMs: stopEndedAt,
        location: [],
        imu: [],
      }),
      subscribe: (listeners) => {
        onLocation = listeners.onLocation;
        return () => {
          onLocation = null;
        };
      },
    };
    const loc = (t: number, speedMps: number, lon: number): LocationSample => ({
      t,
      lat: 32.12345678,
      lon,
      altitudeM: null,
      speedMps,
      courseDeg: 90,
      accuracyM: 5,
      altitudeAccuracyM: null,
    });
    const client = createHarshy({ engine, nativeAvailable: false });
    await client.start({ trigger: "manual" });
    const startedAtMs = client.getState().startedAtMs!;
    const driveMs = 60_000;
    const idleStart = startedAtMs + driveMs;
    const holdMs = 600_000;
    stopEndedAt = idleStart + holdMs;
    const lon = (offsetMs: number) => 34.12345678 + offsetMs / 10_000_000;
    onLocation?.(loc(startedAtMs, 12, lon(0)));
    onLocation?.(loc(idleStart, 0, lon(driveMs)));
    onLocation?.(loc(idleStart + holdMs, 0, lon(driveMs)));
    expect(client.getState().running).toBe(true);
    const session = await client.stop();
    expect(session.trigger).toBe("manual");
    expect(session.metrics.durationMs).toBe(driveMs + holdMs);
    expect(session.location.some((sample) => sample.t === idleStart + holdMs)).toBe(true);
  });

  it("reverts to manual when armWatch fails", async () => {
    const engine: SensorEngine = {
      kind: "native",
      getCapabilities: async () => ({
        location: true,
        accelerometer: false,
        linearAcceleration: false,
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
      start: async () => undefined,
      stop: async () => ({
        sessionId: null,
        startedAtMs: 1,
        endedAtMs: 2,
        location: [],
        imu: [],
      }),
      isRunning: async () => false,
      getSnapshot: async () => ({
        sessionId: null,
        startedAtMs: 1,
        endedAtMs: 2,
        location: [],
        imu: [],
      }),
      subscribe: () => () => {},
      armWatch: async () => {
        throw new Error("Background location is required for automatic trips");
      },
      disarmWatch: async () => undefined,
      subscribeWatch: () => () => {},
    };
    const client = createHarshy({ engine, nativeAvailable: true });
    await expect(client.arm()).rejects.toThrow(/Background location/);
    expect(client.getWatchState()).toMatchObject({
      mode: "manual",
      phase: "disarmed",
      nativeWatch: true,
    });
  });
});
