/** Snap a GPS trace to mapped OpenStreetMap speed limits. Unsigned defaults are not guessed. */

export const SNAP_METERS = 35;
export const HEADING_MAX_DEG = 55;
/** A fix sitting on the road can have a noisier course and still belong to it. */
const CLOSE_SNAP_M = 18;
const CLOSE_HEADING_DEG = 80;
/** GPS speed wobble under the signed limit. 57 km/h in a 50 zone still counts. */
export const OVER_MARGIN_MPS = 1 / 3.6;
export const MIN_SPAN_MS = 2_000;
export const MIN_SPAN_M = 40;
export const MIN_MOVING_MPS = 3;
export const MAX_ACCURACY_M = 40;
const SAMPLE_GAP_MS = 15_000;
const CELL_M = 70;
const MAX_TILES = 8;
/** Stable ~8 km cache grid. Same size as a long-trace Overpass tile. */
export const ROAD_TILE_M = 8_000;
const TILE_M = ROAD_TILE_M;

const METERS_PER_DEG_LAT = 111_320;
/** How close to a tile edge (along the heading) before the next tile is prefetched. */
export const ROAD_TILE_LEAD_M = 1_500;

export type SpeedFix = {
  t: number;
  lat: number;
  lon: number;
  speedMps: number | null;
  courseDeg: number | null;
  accuracyM: number | null;
};

export type RoadSegment = {
  id: string;
  name: string | null;
  /** Travel is only along `bearingDeg` when true. */
  oneway: boolean;
  limitMps: number;
  lat0: number;
  lon0: number;
  lat1: number;
  lon1: number;
  bearingDeg: number;
};

export type OverspeedSpan = {
  startT: number;
  endT: number;
  startIndex: number;
  endIndex: number;
  peakMps: number;
  limitMps: number;
  roadName: string | null;
  lat: number;
  lon: number;
};

export type OverpassBBox = {
  south: number;
  west: number;
  north: number;
  east: number;
};

export function tripHasRecordedSpeeding(
  speedingMps: number | null | undefined,
  events: readonly { type: string }[],
): boolean {
  if (speedingMps != null && speedingMps > 0) {
    return true;
  }
  return events.some((event) => event.type === "speeding");
}

/** OSM `maxspeed` is km/h unless the tag says otherwise. Non-numeric tags are skipped. */
export function parseMaxspeedKmh(raw: string | undefined | null): number | null {
  if (raw == null) {
    return null;
  }
  const text = raw.trim().toLowerCase();
  const match = /^(\d+(?:\.\d+)?)(?:\s*(mph|km\/h|kmh|knots?))?/.exec(text);
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0 || value > 400) {
    return null;
  }
  const unit = match[2];
  if (unit === "mph") {
    return value * 1.609344;
  }
  if (unit?.startsWith("knot")) {
    return value * 1.852;
  }
  return value;
}

const NON_DRIVING = new Set([
  "footway",
  "cycleway",
  "path",
  "pedestrian",
  "steps",
  "corridor",
  "bridleway",
  "platform",
]);

type OverpassWay = {
  type?: string;
  id?: number;
  tags?: { highway?: string; maxspeed?: string; name?: string; oneway?: string };
  geometry?: { lat?: number; lon?: number }[];
};

export function segmentsFromOverpass(payload: unknown): RoadSegment[] {
  const elements = (payload as { elements?: unknown } | null)?.elements;
  if (!Array.isArray(elements)) {
    return [];
  }
  const segments: RoadSegment[] = [];
  for (const element of elements) {
    const way = element as OverpassWay;
    if (way.type !== "way" || way.id == null || !way.geometry || way.geometry.length < 2) {
      continue;
    }
    if (way.tags?.highway != null && NON_DRIVING.has(way.tags.highway)) {
      continue;
    }
    const kmh = parseMaxspeedKmh(way.tags?.maxspeed);
    if (kmh == null) {
      continue;
    }
    const onewayTag = way.tags?.oneway?.trim().toLowerCase();
    const reverse = onewayTag === "-1" || onewayTag === "reverse";
    const oneway = onewayTag === "yes" || onewayTag === "1" || reverse;
    const points = way.geometry.filter(
      (point): point is { lat: number; lon: number } =>
        typeof point.lat === "number" && typeof point.lon === "number",
    );
    const ordered = reverse ? [...points].reverse() : points;
    for (let index = 0; index < ordered.length - 1; index += 1) {
      const start = ordered[index]!;
      const end = ordered[index + 1]!;
      if (start.lat === end.lat && start.lon === end.lon) {
        continue;
      }
      segments.push({
        id: `${way.id}:${index}`,
        name: way.tags?.name?.trim() || null,
        oneway,
        limitMps: kmh / 3.6,
        lat0: start.lat,
        lon0: start.lon,
        lat1: end.lat,
        lon1: end.lon,
        bearingDeg: bearingDeg(start.lat, start.lon, end.lat, end.lon),
      });
    }
  }
  return segments;
}

export function overpassQuery(box: OverpassBBox): string {
  return `[out:json][timeout:25];way["highway"]["maxspeed"](${box.south},${box.west},${box.north},${box.east});out geom;`;
}

const ONE_QUERY_M = 25_000;

/** One box when the drive fits in a city-sized area. Longer traces are tiled. */
export function overpassBboxes(fixes: readonly SpeedFix[]): { boxes: OverpassBBox[]; truncated: boolean } {
  const moving = fixes.filter((fix) => fix.speedMps != null && fix.speedMps >= MIN_MOVING_MPS);
  const origin = moving[0];
  if (!origin) {
    return { boxes: [], truncated: false };
  }
  const cos = Math.cos((origin.lat * Math.PI) / 180) || 1;
  let minLat = origin.lat;
  let maxLat = origin.lat;
  let minLon = origin.lon;
  let maxLon = origin.lon;
  for (const fix of moving) {
    minLat = Math.min(minLat, fix.lat);
    maxLat = Math.max(maxLat, fix.lat);
    minLon = Math.min(minLon, fix.lon);
    maxLon = Math.max(maxLon, fix.lon);
  }
  const spanM = Math.max((maxLat - minLat) * METERS_PER_DEG_LAT, (maxLon - minLon) * METERS_PER_DEG_LAT * cos);
  if (spanM <= ONE_QUERY_M) {
    const padLat = 200 / METERS_PER_DEG_LAT;
    const padLon = 200 / (METERS_PER_DEG_LAT * cos);
    return {
      boxes: [
        {
          south: minLat - padLat,
          north: maxLat + padLat,
          west: minLon - padLon,
          east: maxLon + padLon,
        },
      ],
      truncated: false,
    };
  }
  const keys = new Map<string, OverpassBBox>();
  for (const fix of fixes) {
    if (fix.speedMps == null || fix.speedMps < MIN_MOVING_MPS) {
      continue;
    }
    const x = Math.floor((fix.lon * METERS_PER_DEG_LAT * cos) / TILE_M);
    const y = Math.floor((fix.lat * METERS_PER_DEG_LAT) / TILE_M);
    const key = `${x}:${y}`;
    if (keys.has(key)) {
      continue;
    }
    const padLat = 150 / METERS_PER_DEG_LAT;
    const padLon = 150 / (METERS_PER_DEG_LAT * cos);
    keys.set(key, {
      south: (y * TILE_M) / METERS_PER_DEG_LAT - padLat,
      north: ((y + 1) * TILE_M) / METERS_PER_DEG_LAT + padLat,
      west: (x * TILE_M) / (METERS_PER_DEG_LAT * cos) - padLon,
      east: ((x + 1) * TILE_M) / (METERS_PER_DEG_LAT * cos) + padLon,
    });
  }
  const boxes = [...keys.values()];
  return { boxes: boxes.slice(0, MAX_TILES), truncated: boxes.length > MAX_TILES };
}

export function findOverspeedSpans(
  fixes: readonly SpeedFix[],
  segments: readonly RoadSegment[],
): OverspeedSpan[] {
  if (fixes.length === 0 || segments.length === 0) {
    return [];
  }
  const index = buildIndex(segments, fixes[0]!.lat);
  const spans: OverspeedSpan[] = [];
  let open: OverspeedSpan & { distanceM: number; lastLat: number; lastLon: number } | null = null;
  let previous: RoadSegment | null = null;
  let previousT = Number.NEGATIVE_INFINITY;

  const finish = () => {
    if (!open) {
      return;
    }
    if (open.endT - open.startT >= MIN_SPAN_MS || open.distanceM >= MIN_SPAN_M) {
      spans.push({
        startT: open.startT,
        endT: open.endT,
        startIndex: open.startIndex,
        endIndex: open.endIndex,
        peakMps: open.peakMps,
        limitMps: open.limitMps,
        roadName: open.roadName,
        lat: open.lat,
        lon: open.lon,
      });
    }
    open = null;
  };

  for (let cursor = 0; cursor < fixes.length; cursor += 1) {
    const fix = fixes[cursor]!;
    if (fix.accuracyM != null && fix.accuracyM > MAX_ACCURACY_M) {
      continue;
    }
    const gap = fix.t - previousT > SAMPLE_GAP_MS;
    const course = resolveCourse(fixes, cursor);
    const matched = matchSegment(fix, course, index, previous);
    previous = matched;
    const over =
      matched != null &&
      fix.speedMps != null &&
      fix.speedMps >= MIN_MOVING_MPS &&
      fix.speedMps > matched.limitMps + OVER_MARGIN_MPS;
    const sameLimit = open != null && matched != null && Math.abs(open.limitMps - matched.limitMps) < 0.3;
    if (open && (gap || !over || !sameLimit)) {
      finish();
    }
    if (over && matched) {
      if (!open) {
        open = {
          startT: fix.t,
          endT: fix.t,
          startIndex: cursor,
          endIndex: cursor,
          peakMps: fix.speedMps!,
          limitMps: matched.limitMps,
          roadName: matched.name,
          lat: fix.lat,
          lon: fix.lon,
          distanceM: 0,
          lastLat: fix.lat,
          lastLon: fix.lon,
        };
      } else {
        open.distanceM += metersBetween(open.lastLat, open.lastLon, fix.lat, fix.lon);
        open.lastLat = fix.lat;
        open.lastLon = fix.lon;
        open.endT = fix.t;
        open.endIndex = cursor;
        if (fix.speedMps! > open.peakMps) {
          open.peakMps = fix.speedMps!;
          open.lat = fix.lat;
          open.lon = fix.lon;
          open.roadName = matched.name;
        }
      }
    }
    previousT = fix.t;
  }
  finish();
  return spans;
}

function buildIndex(segments: readonly RoadSegment[], originLat: number): Map<string, RoadSegment[]> {
  const index = new Map<string, RoadSegment[]>();
  const cos = Math.cos((originLat * Math.PI) / 180) || 1;
  for (const segment of segments) {
    const length = metersBetween(segment.lat0, segment.lon0, segment.lat1, segment.lon1);
    const steps = Math.max(1, Math.ceil(length / CELL_M));
    const seen = new Set<string>();
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const key = cellKey(
        segment.lat0 + (segment.lat1 - segment.lat0) * t,
        segment.lon0 + (segment.lon1 - segment.lon0) * t,
        cos,
      );
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const bucket = index.get(key);
      if (bucket) {
        bucket.push(segment);
      } else {
        index.set(key, [segment]);
      }
    }
  }
  return index;
}

function matchSegment(
  fix: SpeedFix,
  courseDeg: number | null,
  index: Map<string, RoadSegment[]>,
  previous: RoadSegment | null,
): RoadSegment | null {
  const cos = Math.cos((fix.lat * Math.PI) / 180) || 1;
  const [x, y] = cellXY(fix.lat, fix.lon, cos);
  let best: { segment: RoadSegment; distance: number; score: number } | null = null;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const bucket = index.get(`${x + dx}:${y + dy}`);
      if (!bucket) {
        continue;
      }
      for (const segment of bucket) {
        const distance = pointSegmentMeters(fix.lat, fix.lon, segment);
        if (distance > SNAP_METERS) {
          continue;
        }
        const heading = headingPenalty(courseDeg, segment, distance);
        if (heading == null) {
          continue;
        }
        const score = distance + heading;
        if (!best || score < best.score) {
          best = { segment, distance, score };
        }
      }
    }
  }
  if (previous) {
    const distance = pointSegmentMeters(fix.lat, fix.lon, previous);
    const heading = headingPenalty(courseDeg, previous, distance);
    if (distance <= SNAP_METERS && heading != null && (!best || distance <= best.distance + 8)) {
      return previous;
    }
  }
  return best?.segment ?? null;
}

function headingPenalty(courseDeg: number | null, segment: RoadSegment, distanceM: number): number | null {
  if (courseDeg == null || !Number.isFinite(courseDeg)) {
    return 0;
  }
  const limit = distanceM <= CLOSE_SNAP_M ? CLOSE_HEADING_DEG : HEADING_MAX_DEG;
  const forward = angleDelta(courseDeg, segment.bearingDeg);
  const backward = segment.oneway ? 180 : angleDelta(courseDeg, segment.bearingDeg + 180);
  const delta = Math.min(forward, backward);
  if (delta > limit) {
    return null;
  }
  return (delta / limit) * 15;
}

function resolveCourse(fixes: readonly SpeedFix[], index: number): number | null {
  const course = fixes[index]?.courseDeg;
  if (course != null && Number.isFinite(course)) {
    return course;
  }
  const here = fixes[index];
  if (!here) {
    return null;
  }
  for (let cursor = index - 1; cursor >= 0 && index - cursor <= 5; cursor -= 1) {
    const prior = fixes[cursor];
    if (!prior) {
      continue;
    }
    if (metersBetween(prior.lat, prior.lon, here.lat, here.lon) >= 8) {
      return bearingDeg(prior.lat, prior.lon, here.lat, here.lon);
    }
  }
  return null;
}

function cellKey(lat: number, lon: number, cos: number): string {
  const [x, y] = cellXY(lat, lon, cos);
  return `${x}:${y}`;
}

function cellXY(lat: number, lon: number, cos: number): [number, number] {
  return [
    Math.floor((lon * METERS_PER_DEG_LAT * cos) / CELL_M),
    Math.floor((lat * METERS_PER_DEG_LAT) / CELL_M),
  ];
}

function pointSegmentMeters(lat: number, lon: number, segment: RoadSegment): number {
  const cos = Math.cos((segment.lat0 * Math.PI) / 180) || 1;
  const px = (lon - segment.lon0) * METERS_PER_DEG_LAT * cos;
  const py = (lat - segment.lat0) * METERS_PER_DEG_LAT;
  const bx = (segment.lon1 - segment.lon0) * METERS_PER_DEG_LAT * cos;
  const by = (segment.lat1 - segment.lat0) * METERS_PER_DEG_LAT;
  const lenSq = bx * bx + by * by;
  if (lenSq < 1e-6) {
    return Math.hypot(px, py);
  }
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / lenSq));
  return Math.hypot(px - bx * t, py - by * t);
}

function metersBetween(lat0: number, lon0: number, lat1: number, lon1: number): number {
  const cos = Math.cos((lat0 * Math.PI) / 180) || 1;
  const x = (lon1 - lon0) * METERS_PER_DEG_LAT * cos;
  const y = (lat1 - lat0) * METERS_PER_DEG_LAT;
  return Math.hypot(x, y);
}

function bearingDeg(lat0: number, lon0: number, lat1: number, lon1: number): number {
  const φ1 = (lat0 * Math.PI) / 180;
  const φ2 = (lat1 * Math.PI) / 180;
  const Δλ = ((lon1 - lon0) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

function angleDelta(a: number, b: number): number {
  const raw = Math.abs(a - b) % 360;
  return raw > 180 ? 360 - raw : raw;
}

export type RoadIndex = Map<string, RoadSegment[]>;

/** Cell index for repeated snaps against one downloaded tile. */
export function indexRoadSegments(segments: readonly RoadSegment[], originLat: number): RoadIndex {
  return buildIndex(segments, originLat);
}

/**
 * Nearest driving segment within the snap radius, or null.
 * A fix worse than `MAX_ACCURACY_M` does not match.
 */
export function matchRoadSegment(
  fix: SpeedFix,
  segments: readonly RoadSegment[],
  previous: RoadSegment | null = null,
  index?: RoadIndex,
): RoadSegment | null {
  if (segments.length === 0) {
    return null;
  }
  if (fix.accuracyM != null && fix.accuracyM > MAX_ACCURACY_M) {
    return null;
  }
  const cells = index ?? buildIndex(segments, fix.lat);
  return matchSegment(fix, resolveCourse([fix], 0), cells, previous);
}

function tileCos(y: number): number {
  const latCenter = ((y + 0.5) * ROAD_TILE_M) / METERS_PER_DEG_LAT;
  return Math.cos((latCenter * Math.PI) / 180) || 1;
}

/** Stable tile id for a fix. Independent of which trip the fix belongs to. */
export function roadTileKey(lat: number, lon: number): string {
  const y = Math.floor((lat * METERS_PER_DEG_LAT) / ROAD_TILE_M);
  const cos = tileCos(y);
  const x = Math.floor((lon * METERS_PER_DEG_LAT * cos) / ROAD_TILE_M);
  return `${x}:${y}`;
}

export function roadTileBoxForKey(key: string): OverpassBBox | null {
  const match = /^(-?\d+):(-?\d+)$/.exec(key);
  if (!match) {
    return null;
  }
  const x = Number(match[1]);
  const y = Number(match[2]);
  const cos = tileCos(y);
  const padLat = 150 / METERS_PER_DEG_LAT;
  const padLon = 150 / (METERS_PER_DEG_LAT * cos);
  return {
    south: (y * ROAD_TILE_M) / METERS_PER_DEG_LAT - padLat,
    north: ((y + 1) * ROAD_TILE_M) / METERS_PER_DEG_LAT + padLat,
    west: (x * ROAD_TILE_M) / (METERS_PER_DEG_LAT * cos) - padLon,
    east: ((x + 1) * ROAD_TILE_M) / (METERS_PER_DEG_LAT * cos) + padLon,
  };
}

export function roadTileBox(lat: number, lon: number): OverpassBBox {
  const box = roadTileBoxForKey(roadTileKey(lat, lon));
  if (!box) {
    throw new Error("road tile key");
  }
  return box;
}

/** Tile in front of the car when the fix is within `leadM` of that edge. */
export function roadTileAhead(
  lat: number,
  lon: number,
  courseDeg: number | null,
  leadM = ROAD_TILE_LEAD_M,
): string | null {
  if (courseDeg == null || !Number.isFinite(courseDeg) || !(leadM > 0)) {
    return null;
  }
  const rad = (courseDeg * Math.PI) / 180;
  const cos = Math.cos((lat * Math.PI) / 180) || 1;
  const lat2 = lat + (leadM * Math.cos(rad)) / METERS_PER_DEG_LAT;
  const lon2 = lon + (leadM * Math.sin(rad)) / (METERS_PER_DEG_LAT * cos);
  const next = roadTileKey(lat2, lon2);
  return next === roadTileKey(lat, lon) ? null : next;
}
