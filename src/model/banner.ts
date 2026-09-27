import type { QuakeEvent } from "../data/types.js";
import { genomeKey } from "./candidates.js";
import { forecastBiggestQuake, type BiggestForecastResult } from "./forecast.js";
import type { Genome } from "./genome.js";

/**
 * EXPERIMENTAL headline banner: the biggest event in the current best genome's next
 * BANNER_LOOKAHEAD_STEPS predicted events after today (no magnitude threshold). Toy model
 * output for teaching — not a real earthquake forecast.
 */

/**
 * Length of the banner's look-ahead chain (the candidates panel uses DEFAULT_LOOKAHEAD_STEPS
 * = 10). Longer chains drift more — still a toy.
 */
export const BANNER_LOOKAHEAD_STEPS = 30;

/** Recompute at most this often while training (ms). Forced updates (reset, rebuild, pause) bypass it. */
export const BANNER_THROTTLE_MS = 500;

export interface BannerInput {
  /** Current best (fittest) genome. */
  genome: Genome;
  fitness: number;
  /** Current GA generation. */
  generation: number;
  /** Catalog the genome was trained on (the slider-filtered events) — the look-ahead starts here. */
  events: QuakeEvent[];
  /** Events used only for place names (the full catalog). Defaults to `events`. */
  placeEvents?: QuakeEvent[];
  /** Predictions are dated after this (start of tomorrow, UTC). */
  referenceTime: number;
  /** Minimum-magnitude slider value the genome was trained with (display only). */
  catalogMinMag: number;
}

export interface BannerSnapshot {
  forecast: BiggestForecastResult;
  /** Genome hash (same helper as the candidates panel). */
  key: string;
  fitness: number;
  /** Generation in which this genome became the best one. */
  foundGeneration: number;
  /** Generation at which the snapshot was computed. */
  generation: number;
  catalogMinMag: number;
  /** Wall-clock time of the computation (ms). */
  computedAt: number;
  /** Increments whenever the displayed prediction changes (drives the flash). */
  version: number;
}

export interface BannerState {
  /** Last computed prediction. Once set it is never cleared again — only replaced or marked stale. */
  snapshot: BannerSnapshot | null;
  /** True while the population is being rebuilt; the last snapshot stays visible. */
  stale: boolean;
  staleReason: string;
}

/** Compact identity of what the banner shows (minute / 0.01 M / 0.1° resolution). */
export function predictionSignature(fc: BiggestForecastResult): string {
  const p = fc.prediction;
  if (!p) return `${fc.stoppedReason}:${fc.stepsRun}`;
  return `${p.step}:${Math.round(p.time / 60_000)}:${p.mag.toFixed(2)}:${p.lat.toFixed(1)}:${p.lon.toFixed(1)}`;
}

/**
 * Keeps the banner's prediction in step with the best genome:
 * - recomputes only when the best genome (or the catalog / reference date) changes,
 * - at most once per `throttleMs` unless forced; a skipped update is remembered as pending
 *   and taken on the next offer after the throttle window (or the next forced offer),
 * - never goes back to empty once it has a value: rebuilds only mark it stale.
 */
export class BannerTracker {
  private snap: BannerSnapshot | null = null;
  private sig = "";
  private stale = false;
  private staleReason = "";
  private lastComputeAt = Number.NEGATIVE_INFINITY;
  private ctxEvents: QuakeEvent[] | null = null;
  private ctxRef = Number.NaN;
  private seenKey = "";
  private seenGeneration = 0;
  private pendingUpdate = false;

  constructor(
    private readonly throttleMs = BANNER_THROTTLE_MS,
    private readonly now: () => number = () => Date.now(),
    private readonly maxSteps = BANNER_LOOKAHEAD_STEPS
  ) {}

  get state(): BannerState {
    return { snapshot: this.snap, stale: this.stale, staleReason: this.staleReason };
  }

  /** A newer best genome was offered but skipped by the throttle. */
  get pending(): boolean {
    return this.pendingUpdate;
  }

  /**
   * Offer the current best genome. Returns true when the state changed (recomputed, or a
   * stale flag was cleared). With `force`, the throttle is bypassed.
   */
  offer(input: BannerInput, force = false): boolean {
    const key = genomeKey(input.genome);
    const sameContext = this.ctxEvents === input.events && this.ctxRef === input.referenceTime;
    if (key !== this.seenKey || !sameContext) {
      this.seenKey = key;
      this.seenGeneration = input.generation;
    }
    // While stale (population rebuilding) only a forced offer or a new catalog/reference date
    // replaces the value — stray updates from the old population must not clear "updating…".
    if (this.stale && !force && sameContext) {
      this.pendingUpdate = true;
      return false;
    }
    if (this.snap && sameContext && key === this.snap.key) {
      this.pendingUpdate = false;
      if (!this.stale) return false;
      this.stale = false;
      this.staleReason = "";
      return true;
    }
    const t = this.now();
    if (!force && this.snap && sameContext && t - this.lastComputeAt < this.throttleMs) {
      this.pendingUpdate = true;
      return false;
    }
    const forecast = forecastBiggestQuake(input.genome, input.events, {
      maxSteps: this.maxSteps,
      referenceTime: input.referenceTime,
      placeEvents: input.placeEvents
    });
    const sig = predictionSignature(forecast);
    const changed = !this.snap || sig !== this.sig;
    this.snap = {
      forecast,
      key,
      fitness: input.fitness,
      foundGeneration: this.seenGeneration,
      generation: input.generation,
      catalogMinMag: input.catalogMinMag,
      computedAt: t,
      version: (this.snap?.version ?? 0) + (changed ? 1 : 0)
    };
    this.sig = sig;
    this.ctxEvents = input.events;
    this.ctxRef = input.referenceTime;
    this.lastComputeAt = t;
    this.pendingUpdate = false;
    this.stale = false;
    this.staleReason = "";
    return true;
  }

  /** Keep the last prediction visible but flag it (e.g. "updating…") while the population rebuilds. */
  markStale(reason = "updating…"): boolean {
    if (!this.snap) return false;
    if (this.stale && this.staleReason === reason) return false;
    this.stale = true;
    this.staleReason = reason;
    return true;
  }
}

/** Where the shown event sits in the chain, e.g. "#7 of 30 in the chain". */
export function bannerChainNote(fc: BiggestForecastResult): string {
  if (!fc.prediction) return "";
  const note = `#${fc.prediction.step} of ${fc.maxSteps} in the chain`;
  if (fc.stoppedReason !== "degenerate") return note;
  return `${note} (chain left the data range after ${fc.chainMags.length} events)`;
}

/** Text for real failures only (there is otherwise always a biggest event to show). */
export function bannerFallbackText(fc: BiggestForecastResult): string {
  if (fc.stoppedReason === "empty") return "No catalog loaded yet.";
  return "The model's look-ahead left the data range at its first step (latitude at a pole or magnitude at the M9.5 cap), so there is no event to show.";
}

/** "in ~5 h", "in ~12 days", "in ~3 months", "in ~2 years" (or "… ago" for past times). */
export function relativeTimeHint(target: number, now: number): string {
  const diff = target - now;
  const abs = Math.abs(diff);
  const hour = 3_600_000;
  const day = 24 * hour;
  let text: string;
  if (abs < hour) text = "<1 h";
  else if (abs < 48 * hour) text = `~${Math.round(abs / hour)} h`;
  else if (abs < 60 * day) text = `~${Math.round(abs / day)} days`;
  else if (abs < 730 * day) text = `~${Math.round(abs / (30.44 * day))} months`;
  else text = `~${Math.round(abs / (365.25 * day))} years`;
  return diff >= 0 ? `in ${text}` : `${text} ago`;
}
