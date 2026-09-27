import { describeLocation } from "../data/places.js";
import { MS_PER_HOUR, type QuakeEvent } from "../data/types.js";
import { extractFeatures, hoursFromLog } from "../features/extract.js";
import { PRED_MAG_MAX, decodeTolerances, predict, type Genome } from "./genome.js";

/**
 * EXPERIMENTAL: ask a genome for its next predicted "big" event after a reference date.
 * This is toy model output for teaching — not a real earthquake forecast.
 */

/** Magnitude threshold for a "big" event (strictly greater than). */
export const BIG_QUAKE_MAG = 6.0;

/** How many predicted events a genome may look ahead to find one above the threshold. */
export const DEFAULT_LOOKAHEAD_STEPS = 10;

export const FORECAST_DISCLAIMER = "Experimental. Not a real earthquake forecast.";

export interface ForecastOptions {
  /** Keep a prediction only if magnitude is strictly above this. Default 6.0. */
  minMag?: number;
  /** Max predicted events to look ahead (short roll-forward). Default 10. */
  maxSteps?: number;
  /**
   * Predictions are dated from max(last catalog event, referenceTime). Pass the start of
   * tomorrow (UTC) so every prediction lands after today. Defaults to the last event time.
   */
  referenceTime?: number;
}

export interface QuakeForecast {
  /** Look-ahead depth: 1 = the very next event predicted from the real catalog. */
  step: number;
  /** Predicted time (epoch ms, UTC). */
  time: number;
  /** Date window implied by the genome's own time tolerance gene. */
  windowStart: number;
  windowEnd: number;
  lat: number;
  lon: number;
  mag: number;
  /** Readable region derived from the nearest real catalog event. */
  region: string;
  /** Location tolerance radius (km) from the genome's distance gene. */
  radiusKm: number;
  /**
   * Model self-score: P(M > minMag) if magnitude errors followed the Laplace kernel the
   * genome is scored with (scale = magTol gene). Not a calibrated probability.
   */
  score: number;
}

export type ForecastStopReason = "found" | "belowThreshold" | "degenerate" | "empty";

export interface ForecastResult {
  /** Predictions are dated from here: max(last catalog event, referenceTime). */
  anchorTime: number;
  /** Time of the last real catalog event (epoch ms). */
  lastEventTime: number;
  /** First predicted event above the threshold within the look-ahead, or null. */
  prediction: QuakeForecast | null;
  /** Magnitude of the very next predicted event (step 1), for honest "none" messages. */
  nextMag: number | null;
  stepsRun: number;
  stoppedReason: ForecastStopReason;
}

/** P(M > threshold) under a Laplace distribution centred on `mag` with scale `scale`. */
export function exceedanceScore(mag: number, threshold: number, scale: number): number {
  const b = Math.max(1e-6, scale);
  const d = mag - threshold;
  return d >= 0 ? 1 - 0.5 * Math.exp(-d / b) : 0.5 * Math.exp(d / b);
}

/** Midnight UTC at the start of the day after `now` — i.e. the first instant after "today". */
export function startOfNextUtcDay(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

/**
 * Deterministic next-big-event prediction for one genome (no sampling, no randomness):
 *
 * 1. From the real catalog, predict the next event; if its magnitude is not above
 *    `minMag`, append it as if it happened and predict again — at most `maxSteps` times.
 *    The look-ahead is kept short because long chains drift (locations walk, magnitudes
 *    run away).
 * 2. The predicted waiting time is counted from the anchor = max(last catalog event,
 *    referenceTime) rather than from the last catalog event. With a catalog that runs up to
 *    today this treats the quiet time since the last event as memoryless, and guarantees the
 *    prediction is dated after the reference date.
 *
 * Stops early (no prediction) if a step is degenerate: latitude pinned at a pole or
 * magnitude pinned at the M9.5 output cap.
 */
export function forecastNextBigQuake(
  genome: Genome,
  events: QuakeEvent[],
  options: ForecastOptions = {}
): ForecastResult {
  const minMag = options.minMag ?? BIG_QUAKE_MAG;
  const maxSteps = options.maxSteps ?? DEFAULT_LOOKAHEAD_STEPS;

  if (events.length === 0) {
    return {
      anchorTime: options.referenceTime ?? 0,
      lastEventTime: 0,
      prediction: null,
      nextMag: null,
      stepsRun: 0,
      stoppedReason: "empty"
    };
  }

  const lastEventTime = events[events.length - 1].time;
  const anchorTime = Math.max(lastEventTime, options.referenceTime ?? lastEventTime);
  const tol = decodeTolerances(genome);
  const history = events.slice();
  let nextMag: number | null = null;
  let stoppedReason: ForecastStopReason = "belowThreshold";
  let stepsRun = 0;

  for (let step = 1; step <= maxSteps; step++) {
    const last = history[history.length - 1];
    const pred = predict(genome, extractFeatures(history, history.length - 1), last.lat, last.lon);
    stepsRun = step;
    if (step === 1) nextMag = pred.mag;
    if (Math.abs(pred.lat) >= 89.9 || pred.mag >= PRED_MAG_MAX) {
      stoppedReason = "degenerate";
      break;
    }
    const gapMs = hoursFromLog(pred.logHours) * MS_PER_HOUR;
    if (pred.mag > minMag) {
      // Waiting time already accumulated by earlier (smaller) look-ahead steps.
      const offset = anchorTime + (last.time - lastEventTime);
      return {
        anchorTime,
        lastEventTime,
        nextMag,
        stepsRun,
        stoppedReason: "found",
        prediction: {
          step,
          time: offset + gapMs,
          windowStart: offset + hoursFromLog(Math.max(0, pred.logHours - tol.timeTol)) * MS_PER_HOUR,
          windowEnd: offset + hoursFromLog(pred.logHours + tol.timeTol) * MS_PER_HOUR,
          lat: pred.lat,
          lon: pred.lon,
          mag: pred.mag,
          region: describeLocation(events, pred.lat, pred.lon),
          radiusKm: tol.distTolKm,
          score: exceedanceScore(pred.mag, minMag, tol.magTol)
        }
      };
    }
    history.push({ id: `lookahead-${step}`, time: last.time + gapMs, lat: pred.lat, lon: pred.lon, mag: pred.mag });
  }

  return { anchorTime, lastEventTime, prediction: null, nextMag, stepsRun, stoppedReason };
}
