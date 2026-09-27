import { describe, expect, it } from "vitest";
import { createGoodPriorGenome, createRandomGenome, softScore } from "./genome.js";
import { extractFeatures, extractTarget } from "../features/extract.js";
import { predict } from "./genome.js";
import {
  MAX_FITNESS_POINTS,
  catalogMinMag,
  evaluateFitness,
  evaluatePredictor,
  evaluationIndices,
  replayWindow,
  scorePrediction,
  type Predictor
} from "./score.js";
import { MAG_WEIGHT, SCORE_TOLERANCES, SCORE_WEIGHTS, magWeight } from "./scoring-config.js";
import type { QuakeEvent } from "../data/types.js";

function seq(n: number): QuakeEvent[] {
  const events: QuakeEvent[] = [];
  let t = 1_600_000_000_000;
  for (let i = 0; i < n; i++) {
    events.push({
      id: String(i),
      time: t,
      lat: 0 + i * 0.01,
      lon: 0,
      mag: 5.6
    });
    t += 3 * 3600_000;
  }
  return events;
}

describe("softScore", () => {
  it("is 1 at zero error and decreases with error", () => {
    expect(softScore(0, 1)).toBe(1);
    expect(softScore(1, 1)).toBeLessThan(1);
    expect(softScore(2, 1)).toBeLessThan(softScore(1, 1));
  });
});

describe("evaluateFitness", () => {
  it("returns a score in (0, 1] on a tiny sequence", () => {
    const fit = evaluateFitness(createGoodPriorGenome(), seq(40), undefined, 35);
    expect(fit).toBeGreaterThan(0);
    expect(fit).toBeLessThanOrEqual(1);
  });

  it("returns 0 when window is empty", () => {
    expect(evaluateFitness(createGoodPriorGenome(), seq(25), 22, 22)).toBe(0);
  });

  it("omitting to uses full series", () => {
    const fit = evaluateFitness(createGoodPriorGenome(), seq(40));
    expect(fit).toBeGreaterThan(0);
  });

  it("perfect prediction scores near 1", () => {
    const actual = { logHours: 2, lat: 10, lon: 20, mag: 6 };
    const pred = { logHours: 2, lat: 10, lon: 20, mag: 6 };
    const s = scorePrediction(pred, actual);
    expect(s.total).toBeGreaterThan(0.99);
  });
});

describe("evaluationIndices", () => {
  it("returns the full window when it fits", () => {
    expect(evaluationIndices(20, 25, 10)).toEqual([20, 21, 22, 23, 24]);
    expect(evaluationIndices(5, 5)).toEqual([]);
  });

  it("subsamples large windows evenly and deterministically", () => {
    const idx = evaluationIndices(20, 50_020, MAX_FITNESS_POINTS);
    expect(idx).toHaveLength(MAX_FITNESS_POINTS);
    expect(idx[0]).toBe(20);
    expect(idx.at(-1)).toBeLessThan(50_020);
    expect(new Set(idx).size).toBe(idx.length);
    expect(evaluationIndices(20, 50_020)).toEqual(idx);
  });
});

describe("evaluateFitness (cached walk-forward)", () => {
  const events = seq(120);
  const manual = (g: ReturnType<typeof createGoodPriorGenome>, positions: number[]) =>
    positions.reduce((s, i) => {
      const pred = predict(g, extractFeatures(events, i), events[i].lat, events[i].lon);
      return s + scorePrediction(pred, extractTarget(events, i)).total;
    }, 0) / positions.length;

  it("matches a direct feature/score loop and is stable across calls", () => {
    const g = createGoodPriorGenome();
    const direct = manual(g, evaluationIndices(20, 100, 1000));
    expect(evaluateFitness(g, events, 20, 100)).toBeCloseTo(direct, 12);
    expect(evaluateFitness(g, events, 20, 100)).toBeCloseTo(direct, 12);
    const other = createRandomGenome(() => 0.3);
    expect(evaluateFitness(other, events, 20, 100)).toBeCloseTo(manual(other, evaluationIndices(20, 100, 1000)), 12);
  });

  it("scores only maxPoints evenly spaced positions on large windows", () => {
    const g = createGoodPriorGenome();
    expect(evaluateFitness(g, events, 20, 119, 10)).toBeCloseTo(manual(g, evaluationIndices(20, 119, 10)), 12);
  });

  it("does not reuse cached features after the event array grows", () => {
    const g = createGoodPriorGenome();
    const grow = seq(60);
    const before = evaluateFitness(g, grow);
    grow.push({ id: "x", time: grow.at(-1)!.time + 1000, lat: 50, lon: 50, mag: 7.5 });
    expect(evaluateFitness(g, grow)).not.toBeCloseTo(before, 6);
  });
});

describe("replayWindow", () => {
  it("emits steps with bins and scores", () => {
    const steps = replayWindow(createGoodPriorGenome(), seq(40), 20, 30);
    expect(steps.length).toBeGreaterThan(0);
    expect(steps[0].score.total).toBeGreaterThan(0);
    expect(steps[0].predTimeBin).toBeGreaterThanOrEqual(0);
    expect(steps[0].actualMagBin).toBeGreaterThanOrEqual(0);
  });
});

describe("scorePrediction with fixed tolerances", () => {
  const actual = { logHours: 2, lat: 0, lon: 0, mag: 6 };

  it("uses the configured constants (1 log-hour, 300 km, 0.5 M)", () => {
    expect(SCORE_TOLERANCES).toEqual({ timeLogHours: 1, distKm: 300, mag: 0.5 });
    expect(SCORE_WEIGHTS.time + SCORE_WEIGHTS.region + SCORE_WEIGHTS.mag).toBeCloseTo(1, 12);
  });

  it("scores exp(-1) when each component is off by exactly one tolerance", () => {
    // 300 km due north of (0,0) ≈ 2.698° of latitude on a 6371 km sphere.
    const dLat = (300 / 6371) * (180 / Math.PI);
    const s = scorePrediction({ logHours: 3, lat: dLat, lon: 0, mag: 6.5 }, actual);
    expect(s.time).toBeCloseTo(Math.exp(-1), 6);
    expect(s.region).toBeCloseTo(Math.exp(-1), 3);
    expect(s.mag).toBeCloseTo(Math.exp(-1), 6);
    expect(s.total).toBeCloseTo(Math.exp(-1), 3);
  });

  it("does not depend on the genome (no evolvable tolerance)", () => {
    const pred = { logHours: 2.4, lat: 1, lon: 1, mag: 5.8 };
    expect(scorePrediction(pred, actual)).toEqual(scorePrediction({ ...pred }, { ...actual }));
  });
});

describe("big-quake magnitude weighting", () => {
  it("magWeight = min(cap, 10^(b·(M − Mmin))), never below 1", () => {
    expect(magWeight(5.5, 5.5)).toBe(1);
    expect(magWeight(5.4, 5.5)).toBe(1);
    expect(magWeight(6.5, 5.5)).toBeCloseTo(10 ** MAG_WEIGHT.b, 12);
    expect(magWeight(7.5, 5.5)).toBeCloseTo(MAG_WEIGHT.cap, 12);
    expect(magWeight(9.0, 5.5)).toBe(MAG_WEIGHT.cap);
    expect(magWeight(6.5, 5.5, 0)).toBe(1); // b = 0 switches the weighting off
  });

  /** Next events alternate small (M5.5) and big (M7.5); location/time are predicted perfectly. */
  function mixed(): { events: QuakeEvent[] } {
    const events: QuakeEvent[] = [];
    let t = 1_600_000_000_000;
    for (let i = 0; i < 60; i++) {
      events.push({ id: String(i), time: t, lat: 0, lon: 0, mag: i % 2 ? 7.5 : 5.5 });
      t += 3 * 3600_000;
    }
    return { events };
  }
  const gap = Math.log1p(3);

  it("missing a big quake costs more than missing a small one by the same amount", () => {
    const { events } = mixed();
    // Both predictors are exact except for a 2.0-magnitude miss on one class of event.
    const missBig: Predictor = (_f, lat, lon) => ({ logHours: gap, lat, lon, mag: 5.5 }); // 7.5s missed by 2
    const missSmall: Predictor = (_f, lat, lon) => ({ logHours: gap, lat, lon, mag: 7.5 }); // 5.5s missed by 2
    const big = evaluatePredictor(missBig, events, 20, 59, undefined, 5.5);
    const small = evaluatePredictor(missSmall, events, 20, 59, undefined, 5.5);
    expect(big).toBeLessThan(small);
    // With weighting off (Mmin far below both → both capped equally) the two misses cost about the same.
    const bigFlat = evaluatePredictor(missBig, events, 20, 59, undefined, 0);
    const smallFlat = evaluatePredictor(missSmall, events, 20, 59, undefined, 0);
    expect(Math.abs(bigFlat - smallFlat)).toBeLessThan(0.01);
    expect(small - big).toBeGreaterThan(0.05);
  });

  it("magnitude part is a weighted mean: a flat-at-minimum guess scores worse than unweighted", () => {
    const { events } = mixed();
    const flatMin: Predictor = (_f, lat, lon) => ({ logHours: gap, lat, lon, mag: 5.5 });
    const got = evaluatePredictor(flatMin, events, 20, 59, undefined, 5.5);
    const idx = evaluationIndices(20, 59, MAX_FITNESS_POINTS);
    let wSum = 0;
    let wMag = 0;
    let plain = 0;
    for (const i of idx) {
      const m = events[i + 1].mag;
      const s = Math.exp(-Math.abs(5.5 - m) / SCORE_TOLERANCES.mag);
      const w = magWeight(m, 5.5);
      wSum += w;
      wMag += w * s;
      plain += s;
    }
    const expected = SCORE_WEIGHTS.time + SCORE_WEIGHTS.region + (SCORE_WEIGHTS.mag * wMag) / wSum;
    expect(got).toBeCloseTo(expected, 10);
    expect(got).toBeLessThan(SCORE_WEIGHTS.time + SCORE_WEIGHTS.region + (SCORE_WEIGHTS.mag * plain) / idx.length);
  });

  it("minMag defaults to the catalog minimum and changes the weights", () => {
    const { events } = mixed();
    expect(catalogMinMag(events)).toBe(5.5);
    expect(catalogMinMag([])).toBe(0);
    const flatMin: Predictor = (_f, lat, lon) => ({ logHours: gap, lat, lon, mag: 5.5 });
    expect(evaluatePredictor(flatMin, events, 20, 59)).toBeCloseTo(
      evaluatePredictor(flatMin, events, 20, 59, undefined, 5.5),
      12
    );
    // With a lower slider minimum both classes hit the cap → no longer a weighted-towards-big mean.
    expect(evaluatePredictor(flatMin, events, 20, 59, undefined, 3.0)).not.toBeCloseTo(
      evaluatePredictor(flatMin, events, 20, 59, undefined, 5.5),
      6
    );
  });
});
