import { describe, expect, it } from "vitest";
import { createGoodPriorGenome, createRandomGenome, softScore } from "./genome.js";
import { evaluateFitness, replayWindow, scorePrediction } from "./score.js";
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

describe("replayWindow", () => {
  it("emits steps with bins and scores", () => {
    const steps = replayWindow(createGoodPriorGenome(), seq(40), 20, 30);
    expect(steps.length).toBeGreaterThan(0);
    expect(steps[0].score.total).toBeGreaterThan(0);
    expect(steps[0].predTimeBin).toBeGreaterThanOrEqual(0);
    expect(steps[0].actualMagBin).toBeGreaterThanOrEqual(0);
  });
});
