import { describe, expect, it } from "vitest";

import { parseDetectorConfig, parseSessionExport, sessionExportSchema } from "./schemas.js";
import { analyzeTrip } from "./detector.js";
import { generateSampleTrip } from "./simulate.js";
import { uploadSession } from "./upload.js";

describe("session contract", () => {
  it("validates a generated session with zod", () => {
    const trip = generateSampleTrip();
    const session = analyzeTrip({
      location: trip.location,
      imu: trip.imu,
      sessionId: trip.sessionId,
      startedAtMs: trip.startedAtMs,
      endedAtMs: trip.endedAtMs,
      device: { platform: "web", model: "sim" },
    });
    expect(sessionExportSchema.parse(session).schemaVersion).toBe(1);
    expect(parseSessionExport(session).sessionId).toBe("sim-sample");
    expect(session.location.some((sample) => sample.roadRmsMps2 != null)).toBe(true);
  });

  it("accepts older location samples without roadRmsMps2", () => {
    const trip = generateSampleTrip();
    const session = analyzeTrip({
      location: trip.location,
      imu: trip.imu,
      sessionId: trip.sessionId,
      startedAtMs: trip.startedAtMs,
      endedAtMs: trip.endedAtMs,
      device: { platform: "web", model: "sim" },
    });
    const stripped = {
      ...session,
      location: session.location.map(({ roadRmsMps2: _road, ...sample }) => sample),
    };
    expect(parseSessionExport(stripped).location[0]).not.toHaveProperty("roadRmsMps2");
  });

  it("uploads through an adapter after schema validation", async () => {
    const trip = generateSampleTrip();
    const session = analyzeTrip({
      location: trip.location,
      imu: trip.imu,
      sessionId: trip.sessionId,
      startedAtMs: trip.startedAtMs,
      endedAtMs: trip.endedAtMs,
      device: { platform: "web", model: "sim" },
    });
    let uploaded = false;
    await uploadSession(session, {
      upload: async (payload) => {
        uploaded = payload.sessionId === session.sessionId;
      },
    });
    expect(uploaded).toBe(true);
  });

  it("fills harsh bands and event levels on older JSON", () => {
    const trip = generateSampleTrip();
    const session = analyzeTrip({
      location: trip.location,
      imu: trip.imu,
      sessionId: trip.sessionId,
      startedAtMs: trip.startedAtMs,
      endedAtMs: trip.endedAtMs,
      device: { platform: "web", model: "sim" },
    });
    const { harshMediumX: _medium, harshHeavyX: _heavy, jerkSettleMs: _settle, ...legacyConfig } =
      session.config;
    const parsedConfig = parseDetectorConfig(legacyConfig);
    expect(parsedConfig.harshMediumX).toBe(1.5);
    expect(parsedConfig.harshHeavyX).toBe(2);
    expect(parsedConfig.jerkSettleMs).toBe(1500);
    expect(parsedConfig.impactPeakMps2).toBe(35);
    expect(parsedConfig.impactSpeedDeltaMps).toBe(4);

    const first = session.events[0];
    if (first) {
      const { level: _level, ...legacyEvent } = first;
      const parsed = parseSessionExport({
        ...session,
        events: [legacyEvent, ...session.events.slice(1)],
      });
      expect(parsed.events[0]?.level).toBe("light");
    }
  });

  it("fills possible_impact and phone_handheld counts on older JSON", () => {
    const trip = generateSampleTrip();
    const session = analyzeTrip({
      location: trip.location,
      imu: trip.imu,
      sessionId: trip.sessionId,
      startedAtMs: trip.startedAtMs,
      endedAtMs: trip.endedAtMs,
      device: { platform: "web", model: "sim" },
    });
    const {
      possible_impact: _impact,
      phone_handheld: _handheld,
      ...legacyCounts
    } = session.metrics.eventCounts;
    const parsed = parseSessionExport({
      ...session,
      metrics: { ...session.metrics, eventCounts: legacyCounts },
    });
    expect(parsed.metrics.eventCounts.possible_impact).toBe(0);
    expect(parsed.metrics.eventCounts.phone_handheld).toBe(0);
  });

  it("fills trigger=manual on older JSON and keeps schemaVersion 1", () => {
    const trip = generateSampleTrip();
    const session = analyzeTrip({
      location: trip.location,
      imu: trip.imu,
      sessionId: trip.sessionId,
      startedAtMs: trip.startedAtMs,
      endedAtMs: trip.endedAtMs,
      device: { platform: "web", model: "sim" },
    });
    expect(session.trigger).toBe("manual");
    const { trigger: _trigger, ...legacy } = session;
    const parsed = parseSessionExport(legacy);
    expect(parsed.trigger).toBe("manual");
    expect(parsed.schemaVersion).toBe(1);
  });

  it("preserves trigger=auto through parse", () => {
    const trip = generateSampleTrip();
    const session = analyzeTrip({
      location: trip.location,
      imu: trip.imu,
      sessionId: trip.sessionId,
      startedAtMs: trip.startedAtMs,
      endedAtMs: trip.endedAtMs,
      device: { platform: "web", model: "sim" },
      trigger: "auto",
    });
    expect(parseSessionExport(session).trigger).toBe("auto");
  });

  it("refuses upload without an adapter", async () => {
    const trip = generateSampleTrip();
    const session = analyzeTrip({
      location: trip.location,
      imu: trip.imu,
      sessionId: trip.sessionId,
      startedAtMs: trip.startedAtMs,
      endedAtMs: trip.endedAtMs,
      device: { platform: "web", model: "sim" },
    });
    await expect(uploadSession(session, null)).rejects.toThrow(
      "No upload adapter configured",
    );
  });
});
