import type { QuakeEvent } from "../data/types.js";
import type { Prediction } from "./genome.js";
import { evaluatePredictor, MAX_FITNESS_POINTS, type Predictor } from "./score.js";

/**
 * No-learning baseline: a "dumb guess" with no evolved parameters, fitted on the TRAINING prefix
 * only and scored with exactly the same function as the genomes (evaluatePredictor):
 *
 * - location: the next quake happens where the current one did (lat/lon unchanged);
 * - gap: the median training gap, taken as the median of log1p(hours between consecutive
 *   training events) — the same scale the time score uses;
 * - magnitude: the median magnitude of the training events (all ≥ the slider minimum).
 *
 * Medians are the natural "typical value" for an absolute-error style score and are robust to the
 * heavy tails of both gaps and magnitudes. They are not tuned to the big-quake magnitude weighting
 * (a weighted median would score a little better on magnitude) — this is meant to be a plain guess.
 */
export interface BaselineParams {
  /** Median log1p(hours) between consecutive training events. */
  logHours: number;
  /** Median training magnitude. */
  mag: number;
  /** Number of training events it was fitted on. */
  trainCount: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Fit on events[0..trainEnd) (the training prefix). */
export function fitBaseline(events: QuakeEvent[], trainEnd: number): BaselineParams {
  const n = Math.max(0, Math.min(trainEnd, events.length));
  const logGaps: number[] = [];
  for (let i = 1; i < n; i++) logGaps.push(Math.log1p(Math.max(0, events[i].time - events[i - 1].time) / 3_600_000));
  return {
    logHours: median(logGaps),
    mag: median(events.slice(0, n).map((e) => e.mag)),
    trainCount: n
  };
}

/** The baseline's prediction of the next event, given the current one. */
export function baselinePredict(params: BaselineParams, lat: number, lon: number): Prediction {
  return { logHours: params.logHours, lat, lon, mag: params.mag };
}

export function baselinePredictor(params: BaselineParams): Predictor {
  return (_features, lat, lon) => baselinePredict(params, lat, lon);
}

/** Baseline walk-forward score over the same window / weighting as evaluateFitness. */
export function evaluateBaseline(
  params: BaselineParams,
  events: QuakeEvent[],
  from?: number,
  to?: number,
  maxPoints = MAX_FITNESS_POINTS,
  minMag?: number
): number {
  return evaluatePredictor(baselinePredictor(params), events, from, to, maxPoints, minMag);
}

/**
 * Skill vs baseline: the share of the gap between the baseline and a perfect score (1) that the
 * model closes. > 0 beats the dumb guess, 0 ties it, < 0 is worse than it.
 */
export function skillVsBaseline(model: number, baseline: number): number {
  if (baseline >= 1) return 0;
  return (model - baseline) / (1 - baseline);
}
