import type { QuakeEvent } from "../data/types.js";
import {
  GENOME_LENGTH,
  clampGeneAt,
  clampGenome,
  cloneGenome,
  createRandomGenome,
  type Genome
} from "../model/genome.js";
import { evaluateFitness } from "../model/score.js";

export interface GaConfig {
  populationSize: number;
  mutationRate: number;
  mutationSigma: number;
  eliteCount: number;
  tournamentSize: number;
  crossoverRate: number;
  /** Slider minimum magnitude, for the big-quake magnitude weights (default: catalog minimum). */
  minMag?: number;
}

export const DEFAULT_GA_CONFIG: GaConfig = {
  populationSize: 48,
  mutationRate: 0.12,
  mutationSigma: 0.35,
  eliteCount: 2,
  tournamentSize: 3,
  crossoverRate: 0.7
};

export interface Individual {
  genome: Genome;
  fitness: number;
}

export interface GaState {
  generation: number;
  population: Individual[];
  best: Individual;
  history: number[];
}

function rngFrom(seed?: number): () => number {
  if (seed === undefined) return Math.random;
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export function initPopulation(
  events: QuakeEvent[],
  trainEnd: number,
  config: GaConfig = DEFAULT_GA_CONFIG,
  rng: () => number = Math.random
): GaState {
  const population: Individual[] = [];
  for (let i = 0; i < config.populationSize; i++) {
    const genome = clampGenome(createRandomGenome(rng));
    const fitness = evaluateFitness(genome, events, undefined, trainEnd, undefined, config.minMag);
    population.push({ genome, fitness });
  }
  population.sort((a, b) => b.fitness - a.fitness);
  return {
    generation: 0,
    population,
    best: { genome: cloneGenome(population[0].genome), fitness: population[0].fitness },
    history: [population[0].fitness]
  };
}

export function tournamentSelect(
  population: Individual[],
  k: number,
  rng: () => number
): Individual {
  let best = population[Math.floor(rng() * population.length)];
  for (let i = 1; i < k; i++) {
    const cand = population[Math.floor(rng() * population.length)];
    if (cand.fitness > best.fitness) best = cand;
  }
  return best;
}

export function crossover(a: Genome, b: Genome, rng: () => number): [Genome, Genome] {
  const c1 = cloneGenome(a);
  const c2 = cloneGenome(b);
  if (rng() < 0.5) {
    // Uniform
    for (let i = 0; i < GENOME_LENGTH; i++) {
      if (rng() < 0.5) {
        const tmp = c1.genes[i];
        c1.genes[i] = c2.genes[i];
        c2.genes[i] = tmp;
      }
    }
  } else {
    // Single point
    const point = 1 + Math.floor(rng() * (GENOME_LENGTH - 1));
    for (let i = point; i < GENOME_LENGTH; i++) {
      const tmp = c1.genes[i];
      c1.genes[i] = c2.genes[i];
      c2.genes[i] = tmp;
    }
  }
  return [clampGenome(c1), clampGenome(c2)];
}

export function mutate(genome: Genome, rate: number, sigma: number, rng: () => number): Genome {
  const g = cloneGenome(genome);
  for (let i = 0; i < GENOME_LENGTH; i++) {
    if (rng() < rate) {
      // Box-Muller-ish via sum of uniforms approximation
      const noise = (rng() + rng() + rng() + rng() - 2) * sigma;
      g.genes[i] += noise;
      clampGeneAt(g.genes, i);
    }
  }
  return g;
}

export function evolveOneGeneration(
  state: GaState,
  events: QuakeEvent[],
  trainEnd: number,
  config: GaConfig = DEFAULT_GA_CONFIG,
  rng: () => number = Math.random
): GaState {
  const next: Individual[] = [];
  // Elitism
  for (let e = 0; e < config.eliteCount && e < state.population.length; e++) {
    next.push({
      genome: cloneGenome(state.population[e].genome),
      fitness: state.population[e].fitness
    });
  }

  while (next.length < config.populationSize) {
    const p1 = tournamentSelect(state.population, config.tournamentSize, rng);
    const p2 = tournamentSelect(state.population, config.tournamentSize, rng);
    let c1: Genome;
    let c2: Genome;
    if (rng() < config.crossoverRate) {
      [c1, c2] = crossover(p1.genome, p2.genome, rng);
    } else {
      c1 = cloneGenome(p1.genome);
      c2 = cloneGenome(p2.genome);
    }
    c1 = mutate(c1, config.mutationRate, config.mutationSigma, rng);
    c2 = mutate(c2, config.mutationRate, config.mutationSigma, rng);
    next.push({ genome: c1, fitness: evaluateFitness(c1, events, undefined, trainEnd, undefined, config.minMag) });
    if (next.length < config.populationSize) {
      next.push({ genome: c2, fitness: evaluateFitness(c2, events, undefined, trainEnd, undefined, config.minMag) });
    }
  }

  next.sort((a, b) => b.fitness - a.fitness);
  const best =
    next[0].fitness >= state.best.fitness
      ? { genome: cloneGenome(next[0].genome), fitness: next[0].fitness }
      : state.best;

  return {
    generation: state.generation + 1,
    population: next,
    best,
    history: [...state.history, best.fitness]
  };
}

export { rngFrom };
