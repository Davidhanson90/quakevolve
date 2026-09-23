import { describe, expect, it } from "vitest";
import {
  extractFeatures,
  extractTarget,
  FEATURE_DIM,
  hoursFromLog,
  magBin,
  minHistoryIndex,
  timeBinFromHours
} from "./extract.js";
import type { QuakeEvent } from "../data/types.js";

function synth(n: number): QuakeEvent[] {
  const out: QuakeEvent[] = [];
  let t = Date.UTC(2020, 0, 1);
  for (let i = 0; i < n; i++) {
    out.push({
      id: `e${i}`,
      time: t,
      lat: -10 + (i % 5),
      lon: 170 + (i % 3),
      mag: 5.5 + (i % 4) * 0.3
    });
    t += (6 + (i % 5)) * 3600_000;
  }
  return out;
}

describe("extractFeatures", () => {
  it("is deterministic and length FEATURE_DIM", () => {
    const events = synth(40);
    const a = extractFeatures(events, 25);
    const b = extractFeatures(events, 25);
    expect(a.length).toBe(FEATURE_DIM);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(a[0]).toBe(events[25].mag);
    expect(minHistoryIndex()).toBe(20);
  });

  it("finds prior same-cell event when present", () => {
    const events: QuakeEvent[] = [];
    let t = 1_000_000;
    for (let i = 0; i < 25; i++) {
      events.push({
        id: String(i),
        time: t,
        lat: 0.1,
        lon: 0.1,
        mag: 5.5
      });
      t += 24 * 3600_000;
    }
    const f = extractFeatures(events, 24);
    expect(f[7]).toBeGreaterThan(0); // log hours since cell
  });

  it("throws on out-of-range index", () => {
    expect(() => extractFeatures(synth(5), 9)).toThrow(/out of range/);
  });
});

describe("extractTarget", () => {
  it("returns next-event targets", () => {
    const events = synth(5);
    const t = extractTarget(events, 2);
    expect(t.mag).toBe(events[3].mag);
    expect(t.lat).toBe(events[3].lat);
    expect(hoursFromLog(t.logHours)).toBeGreaterThan(0);
  });

  it("throws near the end", () => {
    expect(() => extractTarget(synth(3), 2)).toThrow(/out of range/);
  });
});

describe("bins", () => {
  it("maps time and mag into expected bins", () => {
    expect(timeBinFromHours(3)).toBe(0);
    expect(timeBinFromHours(20)).toBe(1);
    expect(timeBinFromHours(100)).toBe(2);
    expect(timeBinFromHours(24 * 14)).toBe(3);
    expect(timeBinFromHours(24 * 60)).toBe(4);
    expect(timeBinFromHours(24 * 120)).toBe(5);
    expect(magBin(5.2)).toBe(0);
    expect(magBin(5.7)).toBe(1);
    expect(magBin(6.2)).toBe(2);
    expect(magBin(6.7)).toBe(3);
    expect(magBin(7.2)).toBe(4);
    expect(magBin(7.8)).toBe(5);
  });
});
