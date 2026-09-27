import { describe, expect, it } from "vitest";
import { MS_PER_DAY, type QuakeEvent } from "./types.js";
import {
  DEFAULT_MIN_MAG,
  MAX_MIN_MAG,
  clampMinMag,
  countAtOrAbove,
  filterByMinMag,
  minMagRange,
  recentIndices,
  roundMag
} from "./filter.js";

/** One event per day, magnitudes cycling 4.5, 4.6, … 7.9 (Gutenberg-Richter not required). */
function catalog(n: number): QuakeEvent[] {
  return Array.from({ length: n }, (_, i) => ({
    id: String(i),
    time: Date.UTC(2020, 0, 1) + i * MS_PER_DAY,
    lat: 0,
    lon: 0,
    mag: Math.round((4.5 + (i % 35) * 0.1) * 100) / 100
  }));
}

describe("roundMag / clampMinMag", () => {
  it("snaps float-noisy slider values to the 0.1 grid", () => {
    expect(roundMag(4.5 + 0.1 * 10)).toBe(5.5);
    expect(roundMag(5.499999999)).toBe(5.5);
    expect(roundMag(6.04)).toBe(6);
  });

  it("clamps into the slider range", () => {
    expect(clampMinMag(3, 4.5)).toBe(4.5);
    expect(clampMinMag(9, 4.5)).toBe(MAX_MIN_MAG);
    expect(clampMinMag(5.23, 4.5)).toBe(5.2);
  });
});

describe("filterByMinMag", () => {
  const events = catalog(70);

  it("keeps events at or above the threshold (inclusive) in time order", () => {
    const out = filterByMinMag(events, 5.5);
    expect(out.every((e) => e.mag >= 5.5)).toBe(true);
    expect(out.some((e) => e.mag === 5.5)).toBe(true);
    for (let i = 1; i < out.length; i++) expect(out[i].time).toBeGreaterThan(out[i - 1].time);
    expect(out.length).toBe(countAtOrAbove(events, 5.5));
  });

  it("treats float noise in the threshold as the rounded value", () => {
    expect(filterByMinMag(events, 5.500000001).length).toBe(filterByMinMag(events, 5.5).length);
    expect(filterByMinMag(events, 4.5 + 0.1 * 10).length).toBe(filterByMinMag(events, 5.5).length);
  });

  it("lowering the threshold never removes events and adds the smaller ones", () => {
    let prev = -1;
    for (let m = MAX_MIN_MAG; m >= 4.5 - 1e-9; m -= 0.1) {
      const n = countAtOrAbove(events, m);
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
    expect(countAtOrAbove(events, 4.5)).toBe(events.length);
    expect(countAtOrAbove(events, 6.5)).toBeLessThan(countAtOrAbove(events, 5.5));
  });

  it("returns an empty list above every magnitude", () => {
    expect(filterByMinMag(events, 9)).toEqual([]);
  });
});

describe("minMagRange", () => {
  it("starts at the catalog floor and defaults to the original M5.5", () => {
    expect(minMagRange(4.5)).toEqual({ min: 4.5, max: MAX_MIN_MAG, step: 0.1, default: DEFAULT_MIN_MAG });
    expect(minMagRange(4.46).min).toBe(4.5);
    expect(minMagRange(5.5).default).toBe(5.5);
  });

  it("raises the default when the data floor is above M5.5", () => {
    const r = minMagRange(6.2);
    expect(r.min).toBe(6.2);
    expect(r.default).toBe(6.2);
    expect(minMagRange(9).min).toBe(MAX_MIN_MAG);
  });
});

describe("recentIndices", () => {
  const events = catalog(200);

  it("covers the last N days of the catalog", () => {
    const idx = recentIndices(events, 30, 1);
    expect(idx.at(-1)).toBe(199);
    expect(idx).toHaveLength(31); // day 169 … day 199 inclusive
    expect(idx[0]).toBe(169);
  });

  it("returns at least minCount and never goes before fromIndex", () => {
    expect(recentIndices(events, 0, 5)).toEqual([195, 196, 197, 198, 199]);
    expect(recentIndices(events, 365, 1, 150)[0]).toBe(150);
    expect(recentIndices([], 30, 3)).toEqual([]);
  });

  it("a lower threshold yields more recent events (and so more predictions)", () => {
    const counts = [7, 6, 5.5, 5, 4.5].map((m) => recentIndices(filterByMinMag(events, m), 60, 1).length);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThan(counts[i - 1]);
  });
});
