import type { QuakeEvent } from "../data/types.js";
import type { Genome } from "./genome.js";
import { forecastNextBigQuake, type ForecastOptions, type ForecastResult } from "./forecast.js";

/**
 * EXPERIMENTAL: the current top-N genomes ("candidates") and a deterministic, cached
 * next-big-event prediction for each. Not a real earthquake forecast.
 */

export const CANDIDATE_COUNT = 3;

/** Anything with a genome and a fitness (e.g. a GA Individual). */
export interface RankedGenome {
  genome: Genome;
  fitness: number;
}

export interface Candidate {
  /** 1-based rank by fitness among distinct genomes. */
  rank: number;
  /** Stable short id derived from the genome's genes. */
  key: string;
  fitness: number;
  genome: Genome;
}

export interface CandidateForecast extends Omit<Candidate, "genome"> {
  forecast: ForecastResult;
}

/** 53-bit string hash (cyrb53) over the raw gene bytes — identical genes ⇒ identical key. */
export function genomeKey(genome: Genome): string {
  const bytes = new Uint8Array(genome.genes.buffer, genome.genes.byteOffset, genome.genes.byteLength);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i], 2654435761);
    h2 = Math.imul(h2 ^ bytes[i], 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36).padStart(11, "0");
}

/** Top `n` distinct genomes by fitness (ties keep population order). */
export function topCandidates(population: RankedGenome[], n = CANDIDATE_COUNT): Candidate[] {
  const sorted = population
    .map((ind, i) => ({ ind, i }))
    .sort((a, b) => b.ind.fitness - a.ind.fitness || a.i - b.i);
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const { ind } of sorted) {
    const key = genomeKey(ind.genome);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ rank: out.length + 1, key, fitness: ind.fitness, genome: ind.genome });
    if (out.length >= n) break;
  }
  return out;
}

/**
 * Caches one forecast per genome for a fixed catalog + reference date + options, so a
 * candidate's displayed prediction changes only when its genome changes.
 */
export class CandidateForecaster {
  private readonly cache = new Map<string, ForecastResult>();

  constructor(
    private readonly events: QuakeEvent[],
    private readonly options: ForecastOptions,
    private readonly maxEntries = 512
  ) {}

  forecastFor(key: string, genome: Genome): ForecastResult {
    const hit = this.cache.get(key);
    if (hit) return hit;
    if (this.cache.size >= this.maxEntries) this.cache.clear();
    const result = forecastNextBigQuake(genome, this.events, this.options);
    this.cache.set(key, result);
    return result;
  }

  forecast(candidates: Candidate[]): CandidateForecast[] {
    return candidates.map(({ genome, ...rest }) => ({
      ...rest,
      forecast: this.forecastFor(rest.key, genome)
    }));
  }

  get size(): number {
    return this.cache.size;
  }
}
