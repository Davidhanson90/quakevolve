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
 * Walk-forward fitness over events[from..to) predicting the next event.
 * `to` is exclusive end index of the *history* positions used (must have to <= length-1).
 */
export function evaluateFitness(
  genome: Genome,
  events: QuakeEvent[],
  from = minHistoryIndex(),
  to?: number
): number {
  const end = to ?? events.length - 1;
  const start = Math.max(minHistoryIndex(), from);
  if (end <= start) return 0;
  let sum = 0;
  let n = 0;
  for (let i = start; i < end; i++) {
    const feats = extractFeatures(events, i);
    const target = extractTarget(events, i);
    const pred = predict(genome, feats, events[i].lat, events[i].lon);
    sum += scorePrediction(pred, target, genome).total;
    n++;
  }
  return sum / n;
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
