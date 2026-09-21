import type { DrivingEvent, DrivingEventType } from "./types.js";

export const COMPOUND_EVENT_TYPES = [
  "harsh_accel",
  "harsh_brake",
  "harsh_corner",
  "swerve",
  "speeding",
] as const satisfies readonly DrivingEventType[];

export type CompoundEventType = (typeof COMPOUND_EVENT_TYPES)[number];

export function isCompoundType(type: DrivingEventType): type is CompoundEventType {
  return (COMPOUND_EVENT_TYPES as readonly DrivingEventType[]).includes(type);
}

export function addOverlap(event: DrivingEvent, type: DrivingEventType): void {
  if (event.type === type || event.overlaps.includes(type)) {
    return;
  }
  event.overlaps.push(type);
}

/** Instant events end at `t`; an open speeding span extends to `now`. */
export function eventSpanEnd(event: DrivingEvent, now: number): number {
  if (event.endT != null) {
    return event.endT;
  }
  if (event.type === "speeding") {
    return now;
  }
  return event.t;
}

export function eventsOverlap(
  a: DrivingEvent,
  b: DrivingEvent,
  now: number,
  windowMs: number,
): boolean {
  const a0 = a.t;
  const a1 = eventSpanEnd(a, now);
  const b0 = b.t;
  const b1 = eventSpanEnd(b, now);
  return a0 - windowMs <= b1 && b0 <= a1 + windowMs;
}

/** Mutates `incoming` and any overlapping kinematic events. */
export function tagCompoundOverlaps(
  events: readonly DrivingEvent[],
  incoming: DrivingEvent,
  now: number,
  windowMs: number,
): void {
  if (!isCompoundType(incoming.type)) {
    return;
  }
  for (const other of events) {
    if (other.id === incoming.id) {
      continue;
    }
    if (!isCompoundType(other.type) || other.type === incoming.type) {
      continue;
    }
    if (!eventsOverlap(incoming, other, now, windowMs)) {
      continue;
    }
    addOverlap(incoming, other.type);
    addOverlap(other, incoming.type);
  }
}
