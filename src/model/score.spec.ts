import { describe, expect, it } from "vitest";
import { createGoodPriorGenome, createRandomGenome, softScore } from "./genome.js";
import { extractFeatures, extractTarget } from "../features/extract.js";
import { predict } from "./genome.js";
import { MAX_FITNESS_POINTS, evaluateFitness, evaluationIndices, replayWindow, scorePrediction } from "./score.js";
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
    const g = createRandomGenome(() => 0.5);
    const actual = { logHours: 2, lat: 10, lon: 20, mag: 6 };
    const pred = { logHours: 2, lat: 10, lon: 20, mag: 6 };
    const s = scorePrediction(pred, actual, g);
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
      return s + scorePrediction(pred, extractTarget(events, i), g).total;
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
