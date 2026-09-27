import { haversineKm, type QuakeEvent } from "../data/types.js";
import {
  extractFeatures,
  extractTarget,
  hoursFromLog,
  magBin,
  minHistoryIndex,
  timeBinFromHours
} from "../features/extract.js";
import {
  decodeTolerances,
  predict,
  softScore,
  type Genome,
  type Prediction
} from "./genome.js";

export interface ScoreBreakdown {
  time: number;
  region: number;
  mag: number;
  total: number;
}

export const SCORE_WEIGHTS = { time: 0.35, region: 0.4, mag: 0.25 } as const;

export function scorePrediction(
  pred: Prediction,
  actual: { logHours: number; lat: number; lon: number; mag: number },
  genome: Genome
): ScoreBreakdown {
  const tol = decodeTolerances(genome);
  const time = softScore(pred.logHours - actual.logHours, tol.timeTol);
  const dist = haversineKm(pred.lat, pred.lon, actual.lat, actual.lon);
  const region = softScore(dist, tol.distTolKm);
  const mag = softScore(pred.mag - actual.mag, tol.magTol);
  const total =
    SCORE_WEIGHTS.time * time + SCORE_WEIGHTS.region * region + SCORE_WEIGHTS.mag * mag;
  return { time, region, mag, total };
}

/**
 * Cap on walk-forward positions scored per fitness call. The M≥5.5 catalog (≈2.8k train /
 * 1.2k holdout positions) is scored exhaustively; denser catalogs (M≥4.5 has ≈66k events)
 * are scored on an evenly spaced, deterministic subsample so a generation stays fast.
 */
export const MAX_FITNESS_POINTS = 3000;

/** Evenly spaced, deterministic subsample of the integers in [start, end), at most `max`. */
export function evaluationIndices(start: number, end: number, max = MAX_FITNESS_POINTS): number[] {
  const n = end - start;
  if (n <= 0) return [];
  if (n <= max) return Array.from({ length: n }, (_, k) => start + k);
  const out: number[] = [];
  for (let k = 0; k < max; k++) out.push(start + Math.floor((k * n) / max));
  return out;
}

/** Precomputed genome-independent inputs for a set of walk-forward positions. */
interface EvalSet {
  count: number;
  features: Float64Array[];
  lat: Float64Array;
  lon: Float64Array;
  targets: { logHours: number; lat: number; lon: number; mag: number }[];
}

/**
 * Features/targets depend only on the catalog, not on the genome, so they are computed once
 * per (events array, window) and reused by every genome and generation. Keyed weakly by the
 * array, so filtering to a new magnitude threshold (a new array) starts a fresh cache.
 */
const evalCache = new WeakMap<QuakeEvent[], Map<string, EvalSet>>();

function getEvalSet(events: QuakeEvent[], start: number, end: number, max: number): EvalSet {
  let byWindow = evalCache.get(events);
  if (!byWindow) {
    byWindow = new Map();
    evalCache.set(events, byWindow);
  }
  const key = `${events.length}:${start}:${end}:${max}`;
  const hit = byWindow.get(key);
  if (hit) return hit;
  const idx = evaluationIndices(start, end, max);
  const set: EvalSet = {
    count: idx.length,
    features: idx.map((i) => extractFeatures(events, i)),
    lat: Float64Array.from(idx, (i) => events[i].lat),
    lon: Float64Array.from(idx, (i) => events[i].lon),
    targets: idx.map((i) => extractTarget(events, i))
  };
  if (byWindow.size > 16) byWindow.clear();
  byWindow.set(key, set);
  return set;
}

/**
 * Walk-forward fitness over events[from..to) predicting the next event.
 * `to` is exclusive end index of the *history* positions used (must have to <= length-1).
 * At most `maxPoints` positions are scored (evenly spaced across the window).
 */
export function evaluateFitness(
  genome: Genome,
  events: QuakeEvent[],
  from = minHistoryIndex(),
  to?: number,
  maxPoints = MAX_FITNESS_POINTS
): number {
  const end = to ?? events.length - 1;
  const start = Math.max(minHistoryIndex(), from);
  if (end <= start) return 0;
  const set = getEvalSet(events, start, end, maxPoints);
  // Same maths as scorePrediction, with the tolerance genes decoded once per genome.
  const tol = decodeTolerances(genome);
  let sum = 0;
  for (let k = 0; k < set.count; k++) {
    const pred = predict(genome, set.features[k], set.lat[k], set.lon[k]);
    const t = set.targets[k];
    sum +=
      SCORE_WEIGHTS.time * softScore(pred.logHours - t.logHours, tol.timeTol) +
      SCORE_WEIGHTS.region * softScore(haversineKm(pred.lat, pred.lon, t.lat, t.lon), tol.distTolKm) +
      SCORE_WEIGHTS.mag * softScore(pred.mag - t.mag, tol.magTol);
  }
  return sum / set.count;
}

export interface ReplayStep {
  index: number;
  prediction: Prediction;
  actual: { logHours: number; lat: number; lon: number; mag: number };
  score: ScoreBreakdown;
  predTimeBin: number;
  actualTimeBin: number;
  predMagBin: number;
  actualMagBin: number;
}

export function replayWindow(
  genome: Genome,
  events: QuakeEvent[],
  from: number,
  to: number
): ReplayStep[] {
  const steps: ReplayStep[] = [];
  const start = Math.max(minHistoryIndex(), from);
  const end = Math.min(to, events.length - 1);
  for (let i = start; i < end; i++) {
    const feats = extractFeatures(events, i);
    const actual = extractTarget(events, i);
    const prediction = predict(genome, feats, events[i].lat, events[i].lon);
    const score = scorePrediction(prediction, actual, genome);
    const predHours = hoursFromLog(prediction.logHours);
    const actualHours = hoursFromLog(actual.logHours);
    steps.push({
      index: i,
      prediction,
      actual,
      score,
      predTimeBin: timeBinFromHours(predHours),
      actualTimeBin: timeBinFromHours(actualHours),
      predMagBin: magBin(prediction.mag),
      actualMagBin: magBin(actual.mag)
    });
  }
  return steps;
}
