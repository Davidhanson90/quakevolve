import { FEATURE_DIM } from "../features/extract.js";

/** Four linear heads: logHours, dLat, dLon, mag — each FEATURE_DIM weights + bias. */
export const HEAD_COUNT = 4;
export const WEIGHTS_PER_HEAD = FEATURE_DIM + 1;
/** Extra genes: timeTol, distTolKm, magTol */
export const TOL_COUNT = 3;
export const GENOME_LENGTH = HEAD_COUNT * WEIGHTS_PER_HEAD + TOL_COUNT;

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
const TOL_MIN = 0.15;
const TOL_MAX = 8;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function createRandomGenome(rng: () => number = Math.random): Genome {
  const genes = new Float64Array(GENOME_LENGTH);
  for (let i = 0; i < HEAD_COUNT * WEIGHTS_PER_HEAD; i++) {
    genes[i] = (rng() * 2 - 1) * 0.5;
  }
  // Tolerances: reasonable defaults (dist gene is hundreds-of-km units)
  genes[HEAD_COUNT * WEIGHTS_PER_HEAD + 0] = 0.8; // log-hours tol
  genes[HEAD_COUNT * WEIGHTS_PER_HEAD + 1] = 8; // → 800 km
  genes[HEAD_COUNT * WEIGHTS_PER_HEAD + 2] = 0.6; // mag tol
  return { genes };
}

export function cloneGenome(g: Genome): Genome {
  return { genes: new Float64Array(g.genes) };
}

export function decodeTolerances(g: Genome): { timeTol: number; distTolKm: number; magTol: number } {
  const base = HEAD_COUNT * WEIGHTS_PER_HEAD;
  return {
    timeTol: clamp(g.genes[base], TOL_MIN, TOL_MAX),
    distTolKm: clamp(g.genes[base + 1], 1, 20) * 100, // 100–2000 km
    magTol: clamp(g.genes[base + 2], TOL_MIN, 2.5)
  };
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
  const base = HEAD_COUNT * WEIGHTS_PER_HEAD;
  if (index < base) {
    genes[index] = clamp(genes[index], WEIGHT_MIN, WEIGHT_MAX);
  } else if (index === base) {
    genes[index] = clamp(genes[index], TOL_MIN, TOL_MAX);
  } else if (index === base + 1) {
    genes[index] = clamp(genes[index], 1, 20);
  } else if (index === base + 2) {
    genes[index] = clamp(genes[index], TOL_MIN, 2.5);
  }
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
  g.genes[HEAD_COUNT * WEIGHTS_PER_HEAD + 0] = 1.0;
  g.genes[HEAD_COUNT * WEIGHTS_PER_HEAD + 1] = 6;
  g.genes[HEAD_COUNT * WEIGHTS_PER_HEAD + 2] = 0.5;
  return clampGenome(g);
}

export { WEIGHT_MIN, WEIGHT_MAX, TOL_MIN, TOL_MAX };
