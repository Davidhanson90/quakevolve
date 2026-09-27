import { describe, expect, it } from "vitest";
import type { QuakeEvent } from "../data/types.js";
import { baselinePredict, baselinePredictor, evaluateBaseline, fitBaseline, skillVsBaseline } from "./baseline.js";
import { evaluatePredictor } from "./score.js";

const HOUR = 3_600_000;

/** Gaps cycle 1h, 3h, 9h; magnitudes cycle 5.5, 5.7, 6.5; positions wander. */
function events(n: number): QuakeEvent[] {
  const gaps = [1, 3, 9];
  const mags = [5.5, 5.7, 6.5];
  const out: QuakeEvent[] = [];
  let t = 1_700_000_000_000;
  for (let i = 0; i < n; i++) {
    out.push({ id: `e${i}`, time: t, lat: (i * 7) % 60, lon: (i * 13) % 170, mag: mags[i % 3] });
    t += gaps[i % 3] * HOUR;
  }
  return out;
}

describe("fitBaseline", () => {
  it("uses the median training log-gap and median training magnitude", () => {
    const ev = events(100);
    const p = fitBaseline(ev, 70);
    expect(p.trainCount).toBe(70);
    expect(p.logHours).toBeCloseTo(Math.log1p(3), 12);
    expect(p.mag).toBeCloseTo(5.7, 12);
  });

  it("only looks at the training prefix", () => {
    const ev = events(100);
    const before = fitBaseline(ev, 70);
    const changed = ev.map((e, i) => (i >= 70 ? { ...e, mag: 9.0, time: e.time + i * 1000 * HOUR } : e));
    expect(fitBaseline(changed, 70)).toEqual(before);
  });

  it("averages the two middle values for an even count and handles tiny inputs", () => {
    const ev = events(4); // mags 5.5, 5.7, 6.5, 5.5 → median (5.5+5.7)/2
    expect(fitBaseline(ev, 4).mag).toBeCloseTo(5.6, 12);
    expect(fitBaseline(ev, 0)).toEqual({ logHours: 0, mag: 0, trainCount: 0 });
    expect(fitBaseline(ev, 99).trainCount).toBe(4);
  });
});

describe("baseline predictor", () => {
  it("predicts the current location, the median gap and the median magnitude", () => {
    const p = { logHours: 1.5, mag: 5.8, trainCount: 10 };
    expect(baselinePredict(p, 12.5, -70)).toEqual({ logHours: 1.5, lat: 12.5, lon: -70, mag: 5.8 });
    expect(baselinePredictor(p)(new Float64Array(11), 3, 4)).toEqual({ logHours: 1.5, lat: 3, lon: 4, mag: 5.8 });
  });

  it("is scored through the exact same path as the genomes", () => {
    const ev = events(200);
    const p = fitBaseline(ev, 140);
    const viaEval = evaluatePredictor(
      (_f, lat, lon) => ({ logHours: p.logHours, lat, lon, mag: p.mag }),
      ev,
      20,
      140,
      undefined,
      5.5
    );
    expect(evaluateBaseline(p, ev, 20, 140, undefined, 5.5)).toBeCloseTo(viaEval, 12);
    const hold = evaluateBaseline(p, ev, 140, 199, undefined, 5.5);
    expect(hold).toBeGreaterThan(0);
    expect(hold).toBeLessThanOrEqual(1);
  });
});

describe("skillVsBaseline", () => {
  it("is the share of the gap to a perfect score that the model closes", () => {
    expect(skillVsBaseline(0.6, 0.6)).toBe(0);
    expect(skillVsBaseline(1, 0.6)).toBeCloseTo(1, 12);
    expect(skillVsBaseline(0.7, 0.6)).toBeCloseTo(0.25, 12);
    expect(skillVsBaseline(0.5, 0.6)).toBeCloseTo(-0.25, 12);
    expect(skillVsBaseline(0.9, 1)).toBe(0);
  });
});
