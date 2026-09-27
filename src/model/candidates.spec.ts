import { describe, expect, it } from "vitest";
import { MS_PER_HOUR, type QuakeEvent } from "../data/types.js";
import { DEFAULT_GA_CONFIG, evolveOneGeneration, initPopulation, rngFrom } from "../ga/evolve.js";
import { CandidateForecaster, genomeKey, topCandidates } from "./candidates.js";
import { forecastNextBigQuake } from "./forecast.js";
import { cloneGenome, createRandomGenome, type Genome } from "./genome.js";

function catalog(n: number): QuakeEvent[] {
  const out: QuakeEvent[] = [];
  let t = Date.UTC(2026, 6, 1);
  for (let i = 0; i < n; i++) {
    out.push({
      id: `c${i}`,
      time: t,
      lat: -20 + (i % 7) * 1.5,
      lon: 165 + (i % 4),
      mag: 5.5 + (i % 6) * 0.25,
      place: `${i} km S of Place${i % 3}, Vanuatu`
    });
    t += (8 + (i % 5) * 6) * MS_PER_HOUR;
  }
  return out;
}

const REF = Date.UTC(2026, 8, 28);

describe("genomeKey", () => {
  it("is identical for identical genes and changes when any gene changes", () => {
    const rng = rngFrom(1);
    const g = createRandomGenome(rng);
    const c = cloneGenome(g);
    expect(genomeKey(c)).toBe(genomeKey(g));
    expect(genomeKey(g)).toHaveLength(11);
    c.genes[7] += 1e-9;
    expect(genomeKey(c)).not.toBe(genomeKey(g));
  });
});

describe("topCandidates", () => {
  const rng = rngFrom(2);
  const a = createRandomGenome(rng);
  const b = createRandomGenome(rng);
  const c = createRandomGenome(rng);
  const d = createRandomGenome(rng);

  it("returns the top 3 distinct genomes by fitness, ranked 1..3", () => {
    const pop = [
      { genome: d, fitness: 0.1 },
      { genome: b, fitness: 0.5 },
      { genome: cloneGenome(a), fitness: 0.9 },
      { genome: a, fitness: 0.9 },
      { genome: c, fitness: 0.3 }
    ];
    const top = topCandidates(pop);
    expect(top.map((t) => t.rank)).toEqual([1, 2, 3]);
    expect(top.map((t) => t.fitness)).toEqual([0.9, 0.5, 0.3]);
    expect(top[0].key).toBe(genomeKey(a));
    expect(top[1].genome).toBe(b);
    expect(topCandidates(pop, 10)).toHaveLength(4);
  });
});

describe("CandidateForecaster", () => {
  const events = catalog(60);

  function population(): { genome: Genome; fitness: number }[] {
    const rng = rngFrom(9);
    return Array.from({ length: 8 }, (_, i) => ({ genome: createRandomGenome(rng), fitness: 1 - i * 0.1 }));
  }

  it("matches a direct forecast and dates everything after the reference date", () => {
    const f = new CandidateForecaster(events, { referenceTime: REF });
    const out = f.forecast(topCandidates(population()));
    expect(out).toHaveLength(3);
    for (const c of out) {
      const genome = population().find((p) => genomeKey(p.genome) === c.key)!.genome;
      expect(c.forecast).toEqual(forecastNextBigQuake(genome, events, { referenceTime: REF }));
      if (c.forecast.prediction) {
        expect(c.forecast.prediction.time).toBeGreaterThanOrEqual(REF);
        expect(c.forecast.prediction.mag).toBeGreaterThan(6);
      }
      expect("genome" in c).toBe(false);
    }
  });

  it("is stable across refreshes and deterministic across instances", () => {
    const f = new CandidateForecaster(events, { referenceTime: REF });
    const first = f.forecast(topCandidates(population()));
    const second = f.forecast(topCandidates(population()));
    expect(second).toEqual(first);
    second.forEach((c, i) => expect(c.forecast).toBe(first[i].forecast)); // served from cache
    expect(f.size).toBe(3);
    const other = new CandidateForecaster(events, { referenceTime: REF }).forecast(topCandidates(population()));
    expect(other).toEqual(first);
  });

  it("changes a candidate's prediction only when that genome changes", () => {
    const f = new CandidateForecaster(events, { referenceTime: REF, maxSteps: 25 });
    const pop = population();
    const before = f.forecast(topCandidates(pop));
    const mutated = cloneGenome(pop[1].genome);
    mutated.genes.fill(0.1, 0, 12);
    pop[1] = { genome: mutated, fitness: pop[1].fitness };
    const after = f.forecast(topCandidates(pop));
    expect(after[0].forecast).toBe(before[0].forecast);
    expect(after[2].forecast).toBe(before[2].forecast);
    expect(after[1].key).not.toBe(before[1].key);
    expect(after[1].forecast).toEqual(forecastNextBigQuake(mutated, events, { referenceTime: REF, maxSteps: 25 }));
  });

  it("keeps predictions stable through GA generations while the top 3 are unchanged", () => {
    const rng = rngFrom(21);
    const cfg = { ...DEFAULT_GA_CONFIG, populationSize: 12 };
    let state = initPopulation(events, 45, cfg, rng);
    const f = new CandidateForecaster(events, { referenceTime: REF });
    const seen = new Map<string, unknown>();
    for (let gen = 0; gen < 6; gen++) {
      for (const c of f.forecast(topCandidates(state.population))) {
        if (seen.has(c.key)) expect(c.forecast).toEqual(seen.get(c.key));
        seen.set(c.key, c.forecast);
      }
      state = evolveOneGeneration(state, events, 45, cfg, rng);
    }
  });

  it("bounds its cache", () => {
    const f = new CandidateForecaster(events, { referenceTime: REF }, 2);
    const cands = topCandidates(population());
    f.forecast(cands);
    expect(f.size).toBeLessThanOrEqual(2);
  });
});
