import { haversineKm, type QuakeEvent } from "../data/types.js";
import {
  extractFeatures,
  extractTarget,
  hoursFromLog,
  magBin,
  minHistoryIndex,
  timeBinFromHours
} from "../features/extract.js";
import { predict, softScore, type Genome, type Prediction } from "./genome.js";
import { SCORE_TOLERANCES, SCORE_WEIGHTS, magWeight } from "./scoring-config.js";

export { SCORE_WEIGHTS, SCORE_TOLERANCES } from "./scoring-config.js";

export interface ScoreBreakdown {
  time: number;
  region: number;
  mag: number;
  /** Per-step weighted sum (0.35·time + 0.40·region + 0.25·mag), unweighted by magnitude. */
  total: number;
}

export type Target = { logHours: number; lat: number; lon: number; mag: number };

/** Score one prediction against the actual next event with the fixed tolerances. */
export function scorePrediction(pred: Prediction, actual: Target): ScoreBreakdown {
  const time = softScore(pred.logHours - actual.logHours, SCORE_TOLERANCES.timeLogHours);
  const region = softScore(haversineKm(pred.lat, pred.lon, actual.lat, actual.lon), SCORE_TOLERANCES.distKm);
  const mag = softScore(pred.mag - actual.mag, SCORE_TOLERANCES.mag);
  const total = SCORE_WEIGHTS.time * time + SCORE_WEIGHTS.region * region + SCORE_WEIGHTS.mag * mag;
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

/** Precomputed predictor-independent inputs for a set of walk-forward positions. */
interface EvalSet {
  count: number;
  features: Float64Array[];
  lat: Float64Array;
  lon: Float64Array;
  targets: Target[];
  /** Big-quake weight of each step's magnitude score (see MAG_WEIGHT). */
  magWeights: Float64Array;
  magWeightSum: number;
}

/**
 * Features/targets depend only on the catalog, not on the genome, so they are computed once
 * per (events array, window, magnitude floor) and reused by every genome and generation. Keyed
 * weakly by the array, so filtering to a new magnitude threshold (a new array) starts fresh.
 */
const evalCache = new WeakMap<QuakeEvent[], Map<string, EvalSet>>();
const floorCache = new WeakMap<QuakeEvent[], number>();

/** Smallest magnitude in the catalog — the slider minimum for a slider-filtered event set. */
export function catalogMinMag(events: QuakeEvent[]): number {
  const hit = floorCache.get(events);
  if (hit !== undefined && events.length > 0) return hit;
  let m = Infinity;
  for (const ev of events) if (ev.mag < m) m = ev.mag;
  const floor = Number.isFinite(m) ? m : 0;
  floorCache.set(events, floor);
  return floor;
}

function getEvalSet(events: QuakeEvent[], start: number, end: number, max: number, minMag: number): EvalSet {
  let byWindow = evalCache.get(events);
  if (!byWindow) {
    byWindow = new Map();
    evalCache.set(events, byWindow);
  }
  const key = `${events.length}:${start}:${end}:${max}:${minMag}`;
  const hit = byWindow.get(key);
  if (hit) return hit;
  const idx = evaluationIndices(start, end, max);
  const targets = idx.map((i) => extractTarget(events, i));
  const magWeights = Float64Array.from(targets, (t) => magWeight(t.mag, minMag));
  const set: EvalSet = {
    count: idx.length,
    features: idx.map((i) => extractFeatures(events, i)),
    lat: Float64Array.from(idx, (i) => events[i].lat),
    lon: Float64Array.from(idx, (i) => events[i].lon),
    targets,
    magWeights,
    magWeightSum: magWeights.reduce((a, b) => a + b, 0)
  };
  if (byWindow.size > 16) byWindow.clear();
  byWindow.set(key, set);
  return set;
}

/** Anything that predicts the next event from the current one's features and position. */
export type Predictor = (features: Float64Array, lat: number, lon: number) => Prediction;

/**
 * Walk-forward score of any predictor over events[from..to) (each position i predicts event i+1).
 * `to` is the exclusive end of the *history* positions (≤ length-1). At most `maxPoints`
 * positions are scored (evenly spaced). `minMag` is the slider minimum used for the big-quake
 * magnitude weights; it defaults to the smallest magnitude in `events`.
 *
 *   score = 0.35 · mean(time) + 0.40 · mean(location) + 0.25 · Σ w·mag / Σ w
 *
 * The GA genome and the no-learning baseline are both scored through this one function.
 */
export function evaluatePredictor(
  predictor: Predictor,
  events: QuakeEvent[],
  from = minHistoryIndex(),
  to?: number,
  maxPoints = MAX_FITNESS_POINTS,
  minMag?: number
): number {
  const end = to ?? events.length - 1;
  const start = Math.max(minHistoryIndex(), from);
  if (end <= start) return 0;
  const set = getEvalSet(events, start, end, maxPoints, minMag ?? catalogMinMag(events));
  let time = 0;
  let region = 0;
  let mag = 0;
  for (let k = 0; k < set.count; k++) {
    const pred = predictor(set.features[k], set.lat[k], set.lon[k]);
    const t = set.targets[k];
    time += softScore(pred.logHours - t.logHours, SCORE_TOLERANCES.timeLogHours);
    region += softScore(haversineKm(pred.lat, pred.lon, t.lat, t.lon), SCORE_TOLERANCES.distKm);
    mag += set.magWeights[k] * softScore(pred.mag - t.mag, SCORE_TOLERANCES.mag);
  }
  return (
    (SCORE_WEIGHTS.time * time) / set.count +
    (SCORE_WEIGHTS.region * region) / set.count +
    (SCORE_WEIGHTS.mag * mag) / set.magWeightSum
  );
}

/** Walk-forward fitness of a genome (see evaluatePredictor). */
export function evaluateFitness(
  genome: Genome,
  events: QuakeEvent[],
  from = minHistoryIndex(),
  to?: number,
  maxPoints = MAX_FITNESS_POINTS,
  minMag?: number
): number {
  return evaluatePredictor((f, lat, lon) => predict(genome, f, lat, lon), events, from, to, maxPoints, minMag);
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
    const score = scorePrediction(prediction, actual);
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
