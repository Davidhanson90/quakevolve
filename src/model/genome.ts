import { FEATURE_DIM } from "../features/extract.js";

/**
 * Four linear heads: logHours, dLat, dLon, mag — each FEATURE_DIM weights + bias. That is the
 * whole genome: scoring tolerances are fixed constants (src/model/scoring-config.ts), not genes.
 */
export const HEAD_COUNT = 4;
export const WEIGHTS_PER_HEAD = FEATURE_DIM + 1;
export const GENOME_LENGTH = HEAD_COUNT * WEIGHTS_PER_HEAD;
/** Older genomes carried 3 trailing tolerance genes (timeTol, distTol, magTol). */
export const LEGACY_GENOME_LENGTH = GENOME_LENGTH + 3;

export interface Genome {
  /** Flat gene vector. */
  genes: Float64Array;
}

export interface Prediction {
  logHours: number;
  lat: number;
  lon: number;
  mag: number;
}

/** Output clamps applied by predict(). */
export const PRED_MAG_MIN = 4.5;
export const PRED_MAG_MAX = 9.5;

const WEIGHT_MIN = -3;
const WEIGHT_MAX = 3;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function createRandomGenome(rng: () => number = Math.random): Genome {
  const genes = new Float64Array(GENOME_LENGTH);
  for (let i = 0; i < GENOME_LENGTH; i++) {
    genes[i] = (rng() * 2 - 1) * 0.5;
  }
  return { genes };
}

export function cloneGenome(g: Genome): Genome {
  return { genes: new Float64Array(g.genes) };
}

/**
 * Build a genome from raw genes, e.g. loaded from a file or an older build. Accepts the current
 * length, or the legacy length with 3 trailing tolerance genes (those are dropped — tolerances are
 * fixed now). Anything else, or non-finite values, is rejected. Weights are clamped.
 */
export function genomeFromGenes(genes: ArrayLike<number>): Genome {
  if (genes.length !== GENOME_LENGTH && genes.length !== LEGACY_GENOME_LENGTH) {
    throw new Error(`Genome must have ${GENOME_LENGTH} genes (or legacy ${LEGACY_GENOME_LENGTH}), got ${genes.length}`);
  }
  const out = new Float64Array(GENOME_LENGTH);
  for (let i = 0; i < GENOME_LENGTH; i++) {
    const v = Number(genes[i]);
    if (!Number.isFinite(v)) throw new Error(`Genome gene ${i} is not a finite number`);
    out[i] = v;
  }
  return clampGenome({ genes: out });
}

function headDot(genes: Float64Array, head: number, features: Float64Array): number {
  const off = head * WEIGHTS_PER_HEAD;
  let s = genes[off + FEATURE_DIM]; // bias
  for (let i = 0; i < FEATURE_DIM; i++) {
    s += genes[off + i] * features[i];
  }
  return s;
}

/**
 * Predict next-event properties from features of event i.
 * Lat/lon are last position + predicted deltas (degrees).
 */
export function predict(
  genome: Genome,
  features: Float64Array,
  lastLat: number,
  lastLon: number
): Prediction {
  const logHours = clamp(headDot(genome.genes, 0, features), 0, Math.log1p(24 * 365));
  const dLat = clamp(headDot(genome.genes, 1, features), -40, 40);
  const dLon = clamp(headDot(genome.genes, 2, features), -60, 60);
  const mag = clamp(headDot(genome.genes, 3, features), PRED_MAG_MIN, PRED_MAG_MAX);
  let lat = clamp(lastLat + dLat, -90, 90);
  let lon = lastLon + dLon;
  while (lon > 180) lon -= 360;
  while (lon < -180) lon += 360;
  return { logHours, lat, lon, mag };
}

/** Soft score in (0, 1] — closer is better. */
export function softScore(err: number, tol: number): number {
  const t = Math.max(1e-6, tol);
  return Math.exp(-Math.abs(err) / t);
}

export function clampGeneAt(genes: Float64Array, index: number): void {
  genes[index] = clamp(genes[index], WEIGHT_MIN, WEIGHT_MAX);
}

export function clampGenome(g: Genome): Genome {
  for (let i = 0; i < g.genes.length; i++) clampGeneAt(g.genes, i);
  return g;
}

/** Hand-crafted “aftershock-ish” prior: next event soon, nearby, similar mag. */
export function createGoodPriorGenome(): Genome {
  const g = createRandomGenome(() => 0.5);
  g.genes.fill(0);
  // logHours: bias toward ~1 day (log1p(24)≈3.22); use mag & count features lightly
  g.genes[0 * WEIGHTS_PER_HEAD + FEATURE_DIM] = 3.0;
  g.genes[0 * WEIGHTS_PER_HEAD + 0] = -0.15; // larger mag → slightly sooner aftershock bias
  // dLat / dLon ≈ 0 (stay near last)
  g.genes[1 * WEIGHTS_PER_HEAD + FEATURE_DIM] = 0;
  g.genes[2 * WEIGHTS_PER_HEAD + FEATURE_DIM] = 0;
  // mag ≈ current mag
  g.genes[3 * WEIGHTS_PER_HEAD + 0] = 0.85;
  g.genes[3 * WEIGHTS_PER_HEAD + FEATURE_DIM] = 0.4;
  return clampGenome(g);
}

export { WEIGHT_MIN, WEIGHT_MAX };
