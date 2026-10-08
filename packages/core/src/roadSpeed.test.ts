import { describe, expect, it } from "vitest";

import {
  findOverspeedSpans,
  matchRoadSegment,
  overpassBboxes,
  overpassQuery,
  parseMaxspeedKmh,
  roadTileAhead,
  roadTileBox,
  roadTileKey,
  segmentsFromOverpass,
  tripHasRecordedSpeeding,
  type RoadSegment,
  type SpeedFix,
} from "./roadSpeed.js";

function eastboundRoad(): RoadSegment[] {
  return [
    {
      id: "1:0",
      name: "Arlozorov",
      oneway: false,
      limitMps: 50 / 3.6,
      lat0: 32.085,
      lon0: 34.78,
      lat1: 32.085,
      lon1: 34.785,
      bearingDeg: 90,
    },
  ];
}

function fix(partial: Partial<SpeedFix> & Pick<SpeedFix, "t" | "speedMps">): SpeedFix {
  return {
    lat: 32.085,
    lon: 34.782,
    courseDeg: 90,
    accuracyM: 5,
    ...partial,
  };
}

describe("road speed", () => {
  it("treats a speeding cap or a speeding event as already recorded", () => {
    expect(tripHasRecordedSpeeding(20, [])).toBe(true);
    expect(tripHasRecordedSpeeding(null, [{ type: "speeding" }])).toBe(true);
    expect(tripHasRecordedSpeeding(null, [{ type: "harsh_brake" }])).toBe(false);
    expect(tripHasRecordedSpeeding(0, [])).toBe(false);
  });

  it("reads numeric maxspeed tags and skips words", () => {
    expect(parseMaxspeedKmh("50")).toBe(50);
    expect(parseMaxspeedKmh("50;30")).toBe(50);
    expect(parseMaxspeedKmh("30 mph")).toBeCloseTo(48.28, 1);
    expect(parseMaxspeedKmh("none")).toBeNull();
    expect(parseMaxspeedKmh("signals")).toBeNull();
    expect(parseMaxspeedKmh("DE:urban")).toBeNull();
  });

  it("builds segments from an Overpass way", () => {
    const segments = segmentsFromOverpass({
      elements: [
        {
          type: "way",
          id: 9,
          tags: { maxspeed: "50", name: "Main", oneway: "yes" },
          geometry: [
            { lat: 1, lon: 2 },
            { lat: 1, lon: 2.001 },
          ],
        },
        { type: "way", id: 10, tags: { maxspeed: "walk" }, geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }] },
      ],
    });
    expect(segments).toHaveLength(1);
    expect(segments[0]?.name).toBe("Main");
    expect(segments[0]?.oneway).toBe(true);
    expect(segments[0]?.limitMps).toBeCloseTo(50 / 3.6);
  });

  it("flags 57 km/h held in a 50 zone", () => {
    const speed = 57 / 3.6;
    const spans = findOverspeedSpans(
      [fix({ t: 0, speedMps: speed }), fix({ t: 1_000, speedMps: speed }), fix({ t: 2_000, speedMps: speed })],
      eastboundRoad(),
    );
    expect(spans).toHaveLength(1);
    expect(spans[0]?.peakMps).toBeCloseTo(speed);
    expect(spans[0]?.limitMps).toBeCloseTo(50 / 3.6);
  });

  it("flags a held stretch over the signed limit and ignores a slower pass", () => {
    const over = findOverspeedSpans(
      [fix({ t: 0, speedMps: 20 }), fix({ t: 2_000, speedMps: 21 }), fix({ t: 4_000, speedMps: 19 })],
      eastboundRoad(),
    );
    expect(over).toHaveLength(1);
    expect(over[0]?.roadName).toBe("Arlozorov");
    expect(over[0]?.peakMps).toBe(21);
    expect(over[0]?.limitMps).toBeCloseTo(50 / 3.6);

    const under = findOverspeedSpans(
      [fix({ t: 0, speedMps: 10 }), fix({ t: 2_000, speedMps: 11 }), fix({ t: 4_000, speedMps: 10 })],
      eastboundRoad(),
    );
    expect(under).toHaveLength(0);
  });

  it("drops a single sample that only blips over the limit", () => {
    const spans = findOverspeedSpans([fix({ t: 0, speedMps: 25 })], eastboundRoad());
    expect(spans).toHaveLength(0);
  });

  it("does not snap a northbound track onto an eastbound road", () => {
    const spans = findOverspeedSpans(
      [
        fix({ t: 0, speedMps: 25, courseDeg: 0 }),
        fix({ t: 2_000, speedMps: 25, courseDeg: 0 }),
        fix({ t: 4_000, speedMps: 25, courseDeg: 0 }),
      ],
      eastboundRoad(),
    );
    expect(spans).toHaveLength(0);
  });

  it("ignores a fix far from the road", () => {
    const spans = findOverspeedSpans(
      [
        fix({ t: 0, speedMps: 25, lat: 32.09 }),
        fix({ t: 2_000, speedMps: 25, lat: 32.09 }),
        fix({ t: 4_000, speedMps: 25, lat: 32.09 }),
      ],
      eastboundRoad(),
    );
    expect(spans).toHaveLength(0);
  });

  it("asks Overpass for ways that have a maxspeed and skips footways", () => {
    const query = overpassQuery({ south: 1, west: 2, north: 3, east: 4 });
    expect(query).toContain('["highway"]["maxspeed"]');
    expect(query).toContain("(1,2,3,4)");
    const foot = segmentsFromOverpass({
      elements: [
        {
          type: "way",
          id: 3,
          tags: { highway: "footway", maxspeed: "5" },
          geometry: [
            { lat: 1, lon: 2 },
            { lat: 1, lon: 2.001 },
          ],
        },
      ],
    });
    expect(foot).toHaveLength(0);
  });

  it("uses one map box for a short drive", () => {
    const plan = overpassBboxes([
      fix({ t: 0, speedMps: 15, lat: 32.08, lon: 34.78 }),
      fix({ t: 1000, speedMps: 15, lat: 32.09, lon: 34.79 }),
    ]);
    expect(plan.boxes).toHaveLength(1);
    expect(plan.truncated).toBe(false);
  });

  it("caps the number of map tiles for a long trace", () => {
    const fixes: SpeedFix[] = [];
    for (let index = 0; index < 20; index += 1) {
      fixes.push(fix({ t: index * 1000, speedMps: 20, lat: 32 + index * 0.2, lon: 34 }));
    }
    const plan = overpassBboxes(fixes);
    expect(plan.boxes.length).toBeLessThanOrEqual(8);
    expect(plan.truncated).toBe(true);
  });

  it("snaps one fix to the signed limit", () => {
    const matched = matchRoadSegment(fix({ t: 0, speedMps: 15 }), eastboundRoad(), null);
    expect(matched?.limitMps).toBeCloseTo(50 / 3.6);
    expect(matchRoadSegment(fix({ t: 0, speedMps: 15, accuracyM: 80 }), eastboundRoad(), null)).toBeNull();
  });

  it("keeps the same tile key for a fix inside one cell", () => {
    const key = roadTileKey(32.085, 34.782);
    expect(roadTileKey(32.08501, 34.78201)).toBe(key);
    const box = roadTileBox(32.085, 34.782);
    expect(box.south).toBeLessThan(32.085);
    expect(box.north).toBeGreaterThan(32.085);
    expect(box.west).toBeLessThan(34.782);
    expect(box.east).toBeGreaterThan(34.782);
  });

  it("names the next tile only when the heading reaches its edge", () => {
    const lat = 32.085;
    const lon = 34.782;
    expect(roadTileAhead(lat, lon, null)).toBeNull();
    const here = roadTileKey(lat, lon);
    const nudge = roadTileAhead(lat, lon, 90, 50);
    expect(nudge === null || nudge === here).toBe(true);
    const leap = roadTileAhead(lat, lon, 90, 20_000);
    expect(leap).not.toBeNull();
    expect(leap).not.toBe(here);
  });
});
