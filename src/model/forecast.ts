import { describeLocation } from "../data/places.js";
import { MS_PER_DAY, MS_PER_HOUR, type QuakeEvent } from "../data/types.js";
import { extractFeatures, hoursFromLog } from "../features/extract.js";
import { PRED_MAG_MAX, decodeTolerances, predict, type Genome } from "./genome.js";

/**
 * EXPERIMENTAL: roll the current best genome forward past the end of the catalog and
 * list the first few predicted "big" events. This is toy model output for teaching —
 * not a real earthquake forecast.
 */

/** Magnitude threshold for a "big" event (strictly greater than). */
export const BIG_QUAKE_MAG = 6.0;

export const FORECAST_DISCLAIMER = "Experimental model output. Not a real earthquake forecast.";

export interface ForecastOptions {
  /** Keep predictions with magnitude strictly above this. Default 6.0. */
  minMag?: number;
  /** How many predictions to return. Default 5. */
  count?: number;
  /** Max autoregressive steps (predicted events) to roll forward. Default 250. */
  maxSteps?: number;
  /** Stop once predicted time passes the catalog end + this many days. Default 365. */
  horizonDays?: number;
  /** Optional extra lower bound (epoch ms) on predicted time, e.g. "today". */
  notBefore?: number;
}

export interface QuakeForecast {
  /** 1-based rank by predicted date. */
  rank: number;
  /** Rollout depth: 1 = the event predicted directly after the last catalog event. */
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

export type ForecastStopReason = "found" | "maxSteps" | "horizon" | "degenerate";

export interface ForecastResult {
  /** Time of the last real catalog event (epoch ms). */
  anchorTime: number;
  forecasts: QuakeForecast[];
  stepsRun: number;
  stoppedReason: ForecastStopReason;
}

/** P(M > threshold) under a Laplace distribution centred on `mag` with scale `scale`. */
export function exceedanceScore(mag: number, threshold: number, scale: number): number {
  const b = Math.max(1e-6, scale);
  const d = mag - threshold;
  return d >= 0 ? 1 - 0.5 * Math.exp(-d / b) : 0.5 * Math.exp(d / b);
}

/**
 * Autoregressive rollout: predict the next event from the real catalog, append it as if it
 * happened, predict again, and so on. Keeps predicted events with mag > minMag that fall
 * after the last catalog event (and after `notBefore`), sorted by date, first `count`.
 *
 * Stops early if the rollout degenerates (latitude pinned at a pole, or magnitude pinned at
 * the M9.5 output cap), because the linear heads have clearly left the range of the
 * training data by then and every later step would build on that.
 */
export function forecastBigQuakes(
  genome: Genome,
  events: QuakeEvent[],
  options: ForecastOptions = {}
): ForecastResult {
  const minMag = options.minMag ?? BIG_QUAKE_MAG;
  const count = options.count ?? 5;
  const maxSteps = options.maxSteps ?? 250;
  const horizonDays = options.horizonDays ?? 365;

  if (events.length === 0) {
    return { anchorTime: 0, forecasts: [], stepsRun: 0, stoppedReason: "maxSteps" };
  }

  const anchorTime = events[events.length - 1].time;
  const after = Math.max(anchorTime, options.notBefore ?? -Infinity);
  const horizonEnd = after + horizonDays * MS_PER_DAY;
  const tol = decodeTolerances(genome);
  const history = events.slice();
  const picked: Omit<QuakeForecast, "rank" | "region">[] = [];
  let stoppedReason: ForecastStopReason = "maxSteps";
  let stepsRun = 0;

  for (let step = 1; step <= maxSteps; step++) {
    const last = history[history.length - 1];
    const pred = predict(genome, extractFeatures(history, history.length - 1), last.lat, last.lon);
    const time = last.time + hoursFromLog(pred.logHours) * MS_PER_HOUR;
    stepsRun = step;
    if (time > horizonEnd) {
      stoppedReason = "horizon";
      break;
    }
    if (Math.abs(pred.lat) >= 89.9 || pred.mag >= PRED_MAG_MAX) {
      stoppedReason = "degenerate";
      break;
    }
    history.push({ id: `forecast-${step}`, time, lat: pred.lat, lon: pred.lon, mag: pred.mag });

    if (pred.mag > minMag && time > after) {
      picked.push({
        step,
        time,
        windowStart: last.time + hoursFromLog(Math.max(0, pred.logHours - tol.timeTol)) * MS_PER_HOUR,
        windowEnd: last.time + hoursFromLog(pred.logHours + tol.timeTol) * MS_PER_HOUR,
        lat: pred.lat,
        lon: pred.lon,
        mag: pred.mag,
        radiusKm: tol.distTolKm,
        score: exceedanceScore(pred.mag, minMag, tol.magTol)
      });
      if (picked.length >= count) {
        stoppedReason = "found";
        break;
      }
    }
  }

  // Rollout time is non-decreasing, but sort explicitly so the contract is obvious.
  picked.sort((a, b) => a.time - b.time || a.step - b.step);
  const forecasts = picked.slice(0, count).map((f, i) => ({
    ...f,
    rank: i + 1,
    region: describeLocation(events, f.lat, f.lon)
  }));
  return { anchorTime, forecasts, stepsRun, stoppedReason };
}
