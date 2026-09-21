import { describe, expect, it } from "vitest";

import { eventsOverlap, tagCompoundOverlaps } from "./compound.js";
import type { DrivingEvent } from "./types.js";

function event(
  type: DrivingEvent["type"],
  t: number,
  extra?: Partial<DrivingEvent>,
): DrivingEvent {
  return {
    id: `${type}-${t}`,
    type,
    t,
    endT: extra?.endT ?? null,
    peak: extra?.peak ?? 4,
    severity: extra?.severity ?? 0.5,
    level: extra?.level ?? "light",
    lat: null,
    lon: null,
    speedMps: 10,
    overlaps: extra?.overlaps ?? [],
  };
}

describe("eventsOverlap", () => {
  it("treats instants within the window as overlapping", () => {
    expect(eventsOverlap(event("harsh_brake", 1000), event("harsh_corner", 1800), 1800, 1500)).toBe(
      true,
    );
    expect(eventsOverlap(event("harsh_brake", 1000), event("harsh_corner", 3000), 3000, 1500)).toBe(
      false,
    );
  });

  it("extends an open speeding span to now", () => {
    const speeding = event("speeding", 1000);
    expect(eventsOverlap(speeding, event("harsh_brake", 4000), 4000, 1500)).toBe(true);
    expect(eventsOverlap(speeding, event("harsh_brake", 4000), 2000, 1500)).toBe(false);
  });
});

describe("tagCompoundOverlaps", () => {
  it("tags both kinematic events and ignores jerk", () => {
    const brake = event("harsh_brake", 1000);
    const corner = event("harsh_corner", 1200);
    const jerk = event("jerk", 1100);
    const events = [brake, jerk, corner];
    tagCompoundOverlaps(events, corner, 1200, 1500);
    expect(corner.overlaps).toEqual(["harsh_brake"]);
    expect(brake.overlaps).toEqual(["harsh_corner"]);
    expect(jerk.overlaps).toEqual([]);
  });
});
