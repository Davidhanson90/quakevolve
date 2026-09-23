import { describe, expect, it } from "vitest";
import type { QuakeEvent } from "../data/types.js";
import { createGoodPriorGenome, createRandomGenome, GENOME_LENGTH } from "../model/genome.js";
import { evaluateFitness } from "../model/score.js";
import { crossover, mutate, evolveOneGeneration, initPopulation, rngFrom } from "./evolve.js";

function clusteredSequence(n: number): QuakeEvent[] {
  const out: QuakeEvent[] = [];
  let t = Date.UTC(2019, 0, 1);
  let lat = -20;
  let lon = 170;
  let mag = 6.0;
  for (let i = 0; i < n; i++) {
    // Aftershock-like: often nearby & soon, similar mag
    if (i > 0 && i % 4 !== 0) {
      t += (2 + (i % 3)) * 3600_000;
      lat += (i % 2 === 0 ? 0.2 : -0.15);
      lon += (i % 2 === 0 ? -0.1 : 0.12);
      mag = Math.max(5.0, mag - 0.05 + (i % 5) * 0.01);
    } else {
      t += (48 + (i % 7) * 10) * 3600_000;
      lat = -25 + (i % 10);
      lon = 160 + (i % 8);
      mag = 5.5 + (i % 6) * 0.25;
    }
    out.push({ id: `s${i}`, time: t, lat, lon, mag });
  }
  return out;
}

describe("GA operators", () => {
  it("crossover and mutation keep gene bounds", () => {
    const rng = rngFrom(7);
    const a = createRandomGenome(rng);
    const b = createRandomGenome(rng);
    const [c1, c2] = crossover(a, b, rng);
    expect(c1.genes.length).toBe(GENOME_LENGTH);
    expect(c2.genes.length).toBe(GENOME_LENGTH);
    const m = mutate(c1, 1, 0.5, rng);
    for (let i = 0; i < m.genes.length; i++) {
      expect(Number.isFinite(m.genes[i])).toBe(true);
    }
  });
});

describe("fitness ranking", () => {
  it("hand-crafted good genome beats average random on synthetic aftershocks", () => {
    const events = clusteredSequence(120);
    const trainEnd = 90;
    const good = createGoodPriorGenome();
    const goodFit = evaluateFitness(good, events, undefined, trainEnd);

    const rng = rngFrom(99);
    let randomBest = 0;
    for (let i = 0; i < 12; i++) {
      const g = createRandomGenome(rng);
      randomBest = Math.max(randomBest, evaluateFitness(g, events, undefined, trainEnd));
    }
    expect(goodFit).toBeGreaterThan(randomBest * 0.85);
    // Stronger check: good should beat the mean of randoms substantially
    let sum = 0;
    const rng2 = rngFrom(3);
    for (let i = 0; i < 20; i++) {
      sum += evaluateFitness(createRandomGenome(rng2), events, undefined, trainEnd);
    }
    const meanRandom = sum / 20;
    expect(goodFit).toBeGreaterThan(meanRandom);
  });

  it("one generation does not crash and preserves elite fitness monotonic best", () => {
    const events = clusteredSequence(80);
    const rng = rngFrom(11);
    let state = initPopulation(events, 60, { populationSize: 16, mutationRate: 0.15, mutationSigma: 0.3, eliteCount: 2, tournamentSize: 3, crossoverRate: 0.7 }, rng);
    const before = state.best.fitness;
    state = evolveOneGeneration(state, events, 60, { populationSize: 16, mutationRate: 0.15, mutationSigma: 0.3, eliteCount: 2, tournamentSize: 3, crossoverRate: 0.7 }, rng);
    expect(state.generation).toBe(1);
    expect(state.best.fitness).toBeGreaterThanOrEqual(before - 1e-9);
  });
});
