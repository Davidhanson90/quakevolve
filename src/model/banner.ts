import type { QuakeEvent } from "../data/types.js";
import { genomeKey } from "./candidates.js";
import { forecastNextBigQuake, type ForecastResult } from "./forecast.js";
import type { Genome } from "./genome.js";

/**
 * EXPERIMENTAL headline banner: the current best genome's next predicted M≥6.0 event after
 * today. Toy model output for teaching — not a real earthquake forecast.
 *
 * The 6.0 threshold is fixed: it does not follow the minimum-magnitude slider (the slider
 * only changes which catalog the genome is trained on and looks ahead from).
 */
export const BANNER_MIN_MAG = 6.0;

/**
 * How many predicted events the banner looks ahead for the first M≥6.0 one. Longer than the
 * candidates panel (DEFAULT_LOOKAHEAD_STEPS = 10): trained genomes' magnitude heads tend to sit
 * below M6, so a 10-step chain rarely reaches it. Longer chains drift more — still a toy.
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
  forecast: ForecastResult;
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
export function predictionSignature(fc: ForecastResult): string {
  const p = fc.prediction;
  if (!p) return `${fc.stoppedReason}:${fc.stepsRun}:${fc.nextMag?.toFixed(2) ?? "-"}`;
  return `found:${Math.round(p.time / 60_000)}:${p.mag.toFixed(2)}:${p.lat.toFixed(1)}:${p.lon.toFixed(1)}`;
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
    const forecast = forecastNextBigQuake(input.genome, input.events, {
      minMag: BANNER_MIN_MAG,
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

/** Honest text when there is no M≥6.0 prediction to show (the banner never goes blank). */
export function bannerFallbackText(fc: ForecastResult, minMag = BANNER_MIN_MAG): string {
  const m = minMag.toFixed(1);
  if (fc.stoppedReason === "empty") return "No catalog loaded yet.";
  if (fc.stoppedReason === "degenerate") {
    return `No M${m}+ predicted: the look-ahead left the data range (pole or M9.5 cap) after ${fc.stepsRun} events.`;
  }
  const next = fc.nextMag === null ? "" : ` The very next predicted event is M${fc.nextMag.toFixed(2)}.`;
  return `No M${m}+ predicted in the next ${fc.stepsRun} events.${next}`;
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
