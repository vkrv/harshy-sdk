import { describe, expect, it } from "vitest";

import { DEFAULT_DETECTOR_CONFIG } from "./config.js";
import {
  HEADING_PUBLISH_DEG,
  advanceHeadingFilter,
  emptyHeadingFilter,
} from "./heading.js";
import { wrapCourseDeg } from "./geo.js";

const minSpeed = DEFAULT_DETECTOR_CONFIG.minSpeedMps;

function fix(
  t: number,
  speedMps: number,
  courseDeg: number,
): { t: number; speedMps: number; courseDeg: number } {
  return { t, speedMps, courseDeg };
}

function run(
  samples: Array<{ t: number; speedMps: number; courseDeg: number }>,
) {
  let filter = emptyHeadingFilter();
  const published: Array<number | null> = [];
  for (const sample of samples) {
    filter = advanceHeadingFilter(filter, sample, minSpeed);
    published.push(filter.headingDeg);
  }
  return { filter, published };
}

describe("heading filter", () => {
  it("stays blank while stopped even when GPS course jumps", () => {
    const { published } = run([
      fix(0, 0, 12),
      fix(500, 0.4, 200),
      fix(1000, 1.2, 40),
      fix(1500, 0, 310),
    ]);
    expect(published.every((value) => value == null)).toBe(true);
  });

  it("needs two agreeing moving samples before the first live heading", () => {
    const first = advanceHeadingFilter(emptyHeadingFilter(), fix(0, 6, 90), minSpeed);
    expect(first.headingDeg).toBeNull();
    const second = advanceHeadingFilter(first, fix(500, 6, 92), minSpeed);
    expect(second.headingDeg).toBeCloseTo(91, 0);
  });

  it("ignores a lone moving blip with a random course", () => {
    const { published } = run([
      fix(0, 6, 10),
      fix(500, 0, 200),
      fix(1000, 6, 270),
      fix(1500, 0, 80),
    ]);
    expect(published.every((value) => value == null)).toBe(true);
  });

  it("holds the last heading when the car stops and course keeps spinning", () => {
    const locked = run([fix(0, 6, 88), fix(500, 6, 90)]).filter;
    expect(locked.headingDeg).not.toBeNull();
    const held = advanceHeadingFilter(locked, fix(1000, 0, 15), minSpeed);
    const still = advanceHeadingFilter(held, fix(1500, 0.3, 300), minSpeed);
    expect(still.headingDeg).toBe(locked.headingDeg);
  });

  it("does not republish 1° GPS chatter while moving", () => {
    let filter = run([fix(0, 8, 180), fix(500, 8, 181)]).filter;
    const locked = filter.headingDeg;
    expect(locked).not.toBeNull();
    for (let i = 0; i < 8; i += 1) {
      filter = advanceHeadingFilter(
        filter,
        fix(1000 + i * 500, 8, 180 + (i % 2 === 0 ? 1 : -1)),
        minSpeed,
      );
    }
    expect(Math.abs((filter.headingDeg ?? 0) - (locked ?? 0))).toBeLessThan(HEADING_PUBLISH_DEG);
  });

  it("tracks a real turn across 0° after it is locked", () => {
    let filter = run([fix(0, 8, 350), fix(500, 8, 352)]).filter;
    filter = advanceHeadingFilter(filter, fix(1300, 8, 20), minSpeed);
    filter = advanceHeadingFilter(filter, fix(2100, 8, 40), minSpeed);
    expect(wrapCourseDeg(filter.headingDeg ?? 0)).toBeGreaterThan(10);
    expect(wrapCourseDeg(filter.headingDeg ?? 0)).toBeLessThan(50);
  });

  it("updates after a stop only once two post-hold samples agree", () => {
    const locked = run([fix(0, 6, 0), fix(500, 6, 2)]).filter;
    const held = advanceHeadingFilter(locked, fix(2000, 0, 180), minSpeed);
    const one = advanceHeadingFilter(held, fix(2500, 6, 178), minSpeed);
    expect(one.headingDeg).toBe(locked.headingDeg);
    const two = advanceHeadingFilter(one, fix(3000, 6, 182), minSpeed);
    const published = wrapCourseDeg(two.headingDeg ?? 0);
    expect(published).toBeGreaterThan(160);
    expect(published).toBeLessThan(200);
  });
});
