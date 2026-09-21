import { DEFAULT_DETECTOR_CONFIG, type SessionExport } from "@harshy/core";
import { describe, expect, it } from "vitest";

import {
  ARCHIVE_INDEX_FILE,
  archiveIndexPayload,
  createMemoryJsonFileStore,
  createSessionArchive,
  parseArchivedSession,
} from "./index";

function sampleSession(id: string, extras: Partial<SessionExport> = {}): SessionExport {
  return {
    schemaVersion: 1,
    sessionId: id,
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
    ...extras,
  };
}

describe("session archive", () => {
  it("persists a compact session that parseSessionExport still accepts", async () => {
    const store = createMemoryJsonFileStore();
    const archive = createSessionArchive(store);
    await archive.put(sampleSession("trip-1"));
    const loaded = await archive.load();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.imu).toEqual([]);
    expect(loaded[0]?.location[0]).toMatchObject({
      lat: 32,
      lon: 34,
      speedMps: 10,
      roadRmsMps2: 1.4,
      altitudeM: null,
    });
    expect(parseArchivedSession(loaded[0])?.sessionId).toBe("trip-1");
  });

  it("skips an invalid session file and keeps the valid neighbor", async () => {
    const store = createMemoryJsonFileStore({
      [ARCHIVE_INDEX_FILE]: archiveIndexPayload(["ok", "bad"]),
      "ok.json": sampleSession("ok", { imu: [] }),
      "bad.json": { sessionId: "bad" },
    });
    const archive = createSessionArchive(store);
    expect((await archive.load()).map((item) => item.sessionId)).toEqual(["ok"]);
  });
});
