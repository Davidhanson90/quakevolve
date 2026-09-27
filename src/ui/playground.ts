import { LitElement, css, html } from "lit";
import { loadEarthquakes, trainHoldoutSplit } from "../data/load.js";
import {
  DEFAULT_MIN_MAG,
  MAX_MIN_MAG,
  MIN_MAG_STEP,
  clampMinMag,
  countAtOrAbove,
  filterByMinMag,
  minMagRange,
  recentIndices,
  type MinMagRange
} from "../data/filter.js";
import type { QuakeEvent } from "../data/types.js";
import {
  FEATURE_DIM,
  FEATURE_NAMES,
  TIME_BIN_LABELS,
  MAG_BIN_LABELS,
  hoursFromLog,
  minHistoryIndex
} from "../features/extract.js";
import { HEAD_COUNT, WEIGHTS_PER_HEAD, type Genome } from "../model/genome.js";
import { MAG_WEIGHT, SCORE_TOLERANCES, SCORE_WEIGHTS } from "../model/scoring-config.js";
import { evaluateBaseline, fitBaseline, skillVsBaseline, type BaselineParams } from "../model/baseline.js";
import { evaluateFitness, replayWindow, type ReplayStep } from "../model/score.js";
import {
  DEFAULT_LOOKAHEAD_STEPS,
  FORECAST_DISCLAIMER,
  startOfNextUtcDay,
  type ForecastResult
} from "../model/forecast.js";
import {
  CANDIDATE_COUNT,
  CandidateForecaster,
  topCandidates,
  type CandidateForecast
} from "../model/candidates.js";
import {
  DEFAULT_GA_CONFIG,
  evolveOneGeneration,
  initPopulation,
  type GaConfig,
  type GaState
} from "../ga/evolve.js";
import { BANNER_LOOKAHEAD_STEPS, BannerTracker } from "../model/banner.js";
import { bannerStore } from "./banner-store.js";
import "./fitness-chart.js";
import { CANDIDATE_COLORS, HEADLINE_STYLE, type MapCandidate, type QvQuakeMap } from "./quake-map.js";
import { FOCUS_HEADLINE_EVENT, headlineFromSnapshot } from "./headline.js";

/** Walk-forward predictions shown on the map/replay: one per event in the catalog's last N days. */
export const RECENT_PREDICTION_DAYS = 90;
const MIN_RECENT_PREDICTIONS = 3;
const MAX_RECENT_PREDICTIONS = 2500;
/** Wait this long after the last slider movement before rebuilding the event set + population. */
const MIN_MAG_DEBOUNCE_MS = 250;

const fmt = (n: number) => n.toLocaleString("en-GB");

export class QvPlayground extends LitElement {
  static properties = {
    loading: { state: true },
    error: { state: true },
    training: { state: true },
    generation: { state: true },
    bestTrain: { state: true },
    holdoutScore: { state: true },
    baselineTrain: { state: true },
    baselineHoldout: { state: true },
    popSize: { state: true },
    mutationRate: { state: true },
    speed: { state: true },
    statusMsg: { state: true },
    eventCount: { state: true },
    trainCount: { state: true },
    holdoutCount: { state: true },
    history: { state: true },
    replayIndex: { state: true },
    meanPop: { state: true },
    candidates: { state: true },
    minMag: { state: true },
    minMagInput: { state: true },
    magRange: { state: true }
  };

  declare loading: boolean;
  declare error: string;
  declare training: boolean;
  declare generation: number;
  declare bestTrain: number;
  declare holdoutScore: number;
  /** No-learning baseline scored with the same function on train / holdout (NaN if too few events). */
  declare baselineTrain: number;
  declare baselineHoldout: number;
  private baselineParams: BaselineParams | null = null;
  declare popSize: number;
  declare mutationRate: number;
  declare speed: number;
  declare statusMsg: string;
  declare eventCount: number;
  declare trainCount: number;
  declare holdoutCount: number;
  declare history: number[];
  declare replayIndex: number;
  declare meanPop: number;
  declare candidates: CandidateForecast[];
  /** Applied minimum magnitude: events ≥ this count, are trained on, and are predicted. */
  declare minMag: number;
  /** Live slider value (applied after a short debounce). */
  declare minMagInput: number;
  declare magRange: MinMagRange;

  /** Headline banner: best genome's next M≥6.0 prediction (throttled, never cleared). */
  private banner = new BannerTracker();
  /** Full bundled catalog (M ≥ data floor). */
  private catalog: QuakeEvent[] = [];
  private minMagTimer: ReturnType<typeof setTimeout> | null = null;
  /** Events with mag ≥ minMag — everything below (training, holdout, replay, map) uses these. */
  private allEvents: QuakeEvent[] = [];
  /** Exclusive end index of the train prefix within allEvents. */
  private trainEnd = 0;
  private ga: GaState | null = null;
  private rafId: number | null = null;
  private lastTick = 0;
  private replaySteps: ReplayStep[] = [];
  private datasetMeta = { source: "", query: "" };
  /** Session reference date: predictions must land after "today" (UTC) as of load/reset. */
  private referenceTime = 0;
  private forecaster: CandidateForecaster | null = null;
  /** Generation at which each candidate genome (by key) first appeared in the top 3. */
  private candidateSince = new Map<string, number>();

  constructor() {
    super();
    this.loading = true;
    this.error = "";
    this.training = false;
    this.generation = 0;
    this.bestTrain = 0;
    this.holdoutScore = 0;
    this.baselineTrain = Number.NaN;
    this.baselineHoldout = Number.NaN;
    this.popSize = DEFAULT_GA_CONFIG.populationSize;
    this.mutationRate = DEFAULT_GA_CONFIG.mutationRate;
    this.speed = 4;
    this.statusMsg = "Loading catalog…";
    this.eventCount = 0;
    this.trainCount = 0;
    this.holdoutCount = 0;
    this.history = [];
    this.replayIndex = 0;
    this.meanPop = 0;
    this.candidates = [];
    this.minMag = DEFAULT_MIN_MAG;
    this.minMagInput = DEFAULT_MIN_MAG;
    this.magRange = { min: DEFAULT_MIN_MAG, max: MAX_MIN_MAG, step: MIN_MAG_STEP, default: DEFAULT_MIN_MAG };
  }

  static styles = css`
    :host {
      display: block;
    }
    .disclaimer {
      background: rgba(240, 180, 41, 0.12);
      border: 1px solid rgba(240, 180, 41, 0.45);
      color: var(--qv-text, #e8eef7);
      border-radius: var(--qv-radius, 12px);
      padding: 12px 14px;
      margin-bottom: 16px;
      font-size: 0.92rem;
    }
    .disclaimer strong {
      color: var(--qv-warn, #f0b429);
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(280px, 340px) 1fr;
      gap: 16px;
      align-items: start;
    }
    @media (max-width: 900px) {
      .layout {
        grid-template-columns: 1fr;
      }
    }
    .panel {
      background: var(--qv-panel, #101827);
      border: 1px solid var(--qv-border, #2a3b55);
      border-radius: var(--qv-radius, 12px);
      padding: 16px;
    }
    .panel h2 {
      margin: 0 0 12px;
      font-size: 1rem;
    }
    label {
      display: block;
      font-size: 0.8rem;
      color: var(--qv-muted, #9aa8bc);
      margin: 10px 0 4px;
    }
    input[type="range"],
    button {
      font: inherit;
      color: var(--qv-text, #e8eef7);
    }
    input[type="range"] {
      width: 100%;
    }
    button {
      background: var(--qv-btn, #1b2a44);
      border: 1px solid var(--qv-border, #2a3b55);
      border-radius: 8px;
      padding: 8px 12px;
      cursor: pointer;
    }
    button:hover:not(:disabled) {
      background: var(--qv-btn-hover, #243552);
    }
    button:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
    button.primary {
      background: var(--qv-accent, #5b9dff);
      border-color: transparent;
      color: #061018;
      font-weight: 600;
    }
    button.primary:hover:not(:disabled) {
      filter: brightness(1.08);
      background: var(--qv-accent, #5b9dff);
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
    }
    .stats {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-top: 12px;
      font-size: 0.85rem;
    }
    .stat {
      background: rgba(0, 0, 0, 0.2);
      border-radius: 8px;
      padding: 8px 10px;
    }
    .stat .k {
      color: var(--qv-muted, #9aa8bc);
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .stat .v {
      font-variant-numeric: tabular-nums;
      font-weight: 600;
    }
    .edu {
      margin-top: 14px;
      font-size: 0.82rem;
      color: var(--qv-muted, #9aa8bc);
    }
    .edu code {
      font-size: 0.78rem;
    }
    .stack {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .genome {
      font-size: 0.8rem;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      max-height: 160px;
      overflow: auto;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 8px;
      padding: 8px 10px;
      white-space: pre-wrap;
    }
    .compare {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      font-size: 0.85rem;
    }
    .compare .box {
      background: rgba(0, 0, 0, 0.2);
      border-radius: 8px;
      padding: 10px;
    }
    .muted {
      color: var(--qv-muted, #9aa8bc);
    }
    .err {
      color: var(--qv-danger, #ff6b8a);
    }
    .experimental {
      background: rgba(255, 107, 138, 0.1);
      border: 1px solid rgba(255, 107, 138, 0.45);
      border-radius: 8px;
      padding: 8px 10px;
      margin-bottom: 10px;
      font-size: 0.85rem;
    }
    .experimental strong {
      color: var(--qv-danger, #ff6b8a);
    }
    table.forecast {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.82rem;
      font-variant-numeric: tabular-nums;
    }
    table.forecast th,
    table.forecast td {
      text-align: left;
      padding: 6px 6px;
      border-bottom: 1px solid var(--qv-border, #2a3b55);
      vertical-align: top;
    }
    table.forecast th {
      color: var(--qv-muted, #9aa8bc);
      font-weight: 500;
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .swatch {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      border: 2px solid;
      font-size: 0.7rem;
      font-weight: 700;
      margin-right: 4px;
    }
    .mag-readout {
      float: right;
      color: var(--qv-text, #e8eef7);
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .mag-ticks {
      display: flex;
      justify-content: space-between;
      font-size: 0.7rem;
      color: var(--qv-muted, #9aa8bc);
    }
    .mag-counts {
      margin-top: 4px;
      font-size: 0.8rem;
      color: var(--qv-muted, #9aa8bc);
      font-variant-numeric: tabular-nums;
    }
    .mag-counts strong {
      color: var(--qv-text, #e8eef7);
    }
    .baseline {
      margin-top: 12px;
    }
    .baseline td:not(:first-child),
    .baseline th:not(:first-child) {
      text-align: right;
    }
    .good {
      color: var(--qv-success, #3dd68c);
    }
    .bad {
      color: var(--qv-danger, #ff6b8a);
    }
    .headline-swatch {
      border-style: dashed;
      font-size: 0.8rem;
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
      margin-top: 6px;
      font-size: 0.8rem;
    }
    table.forecast .sub {
      color: var(--qv-muted, #9aa8bc);
      font-size: 0.74rem;
    }
  `;

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener(FOCUS_HEADLINE_EVENT, this.onFocusHeadline);
    void this.bootstrap();
  }

  disconnectedCallback(): void {
    window.removeEventListener(FOCUS_HEADLINE_EVENT, this.onFocusHeadline);
    this.stopLoop();
    if (this.minMagTimer !== null) clearTimeout(this.minMagTimer);
    super.disconnectedCallback();
  }

  /** Banner place name clicked: scroll the map into view and flash the headline marker. */
  private onFocusHeadline = (): void => {
    const map = this.renderRoot.querySelector<QvQuakeMap>("qv-quake-map");
    map?.focusHeadline();
  };

  private async bootstrap(): Promise<void> {
    try {
      const ds = await loadEarthquakes();
      this.catalog = ds.events;
      this.datasetMeta = { source: ds.source, query: ds.query };
      this.magRange = minMagRange(ds.minMag);
      this.minMag = this.magRange.default;
      this.minMagInput = this.minMag;
      this.applyMinMag();
      this.loading = false;
      this.statusMsg =
        `Loaded ${fmt(ds.count)} events (M≥${this.magRange.min.toFixed(1)} catalog) · ` +
        `using M≥${this.minMag.toFixed(1)}: train ${fmt(this.trainCount)} / holdout ${fmt(this.holdoutCount)}`;
    } catch (err) {
      this.loading = false;
      this.error = err instanceof Error ? err.message : String(err);
      this.statusMsg = "Failed to load dataset";
    }
  }

  private config(): GaConfig {
    return {
      ...DEFAULT_GA_CONFIG,
      populationSize: this.popSize,
      mutationRate: this.mutationRate,
      minMag: this.minMag
    };
  }

  /**
   * Rebuild everything that depends on the event set for the current `minMag`: filtered
   * events, chronological 70/30 train/holdout split, population, holdout score, replay and
   * candidate forecasts. Fitness depends on the event set, so the population starts over.
   */
  private applyMinMag(): void {
    this.allEvents = filterByMinMag(this.catalog, this.minMag);
    const n = this.allEvents.length;
    if (n >= 4) {
      const { train, holdout } = trainHoldoutSplit(this.allEvents, 0.7);
      this.trainEnd = train.length;
      this.trainCount = train.length;
      this.holdoutCount = holdout.length;
    } else {
      this.trainEnd = n;
      this.trainCount = n;
      this.holdoutCount = 0;
    }
    this.eventCount = n;
    this.refreshBaseline();
    this.resetGa();
  }

  /** Fit the no-learning baseline on the training prefix and score it on train + holdout. */
  private refreshBaseline(): void {
    const n = this.allEvents.length;
    if (n < minHistoryIndex() + 4) {
      this.baselineParams = null;
      this.baselineTrain = Number.NaN;
      this.baselineHoldout = Number.NaN;
      return;
    }
    const params = fitBaseline(this.allEvents, this.trainEnd);
    this.baselineParams = params;
    this.baselineTrain = evaluateBaseline(params, this.allEvents, undefined, this.trainEnd, undefined, this.minMag);
    this.baselineHoldout = evaluateBaseline(
      params,
      this.allEvents,
      Math.max(minHistoryIndex(), this.trainEnd),
      n - 1,
      undefined,
      this.minMag
    );
  }

  /** Slider input: update the readout now, rebuild (debounced) once the user stops dragging. */
  private onMinMagInput(value: number): void {
    this.minMagInput = clampMinMag(value, this.magRange.min, this.magRange.max);
    // Keep the banner's last prediction visible (dimmed) until the rebuilt population is ready.
    if (this.minMagInput !== this.minMag) this.banner.markStale("updating…");
    if (this.minMagTimer !== null) clearTimeout(this.minMagTimer);
    this.minMagTimer = setTimeout(() => this.commitMinMag(), MIN_MAG_DEBOUNCE_MS);
  }

  private commitMinMag(): void {
    if (this.minMagTimer !== null) clearTimeout(this.minMagTimer);
    this.minMagTimer = null;
    if (this.minMagInput === this.minMag || this.loading || this.error) {
      this.updateBanner(true); // slider returned to the applied value: clears "updating…"
      return;
    }
    const wasTraining = this.training;
    this.minMag = this.minMagInput;
    this.applyMinMag();
    if (!this.ga) return;
    const summary = `M≥${this.minMag.toFixed(1)}: ${fmt(this.eventCount)} events, population reset`;
    if (wasTraining) {
      this.onTrain();
      this.statusMsg = `${summary} — retraining…`;
    } else {
      this.statusMsg = `${summary} — press Train to evolve`;
    }
  }

  private resetGa(): void {
    this.stopLoop();
    this.training = false;
    if (this.allEvents.length < minHistoryIndex() + 4) {
      this.ga = null;
      this.forecaster = null;
      this.candidates = [];
      this.candidateSince.clear();
      this.replaySteps = [];
      this.replayIndex = 0;
      this.history = [];
      this.generation = 0;
      this.bestTrain = 0;
      this.holdoutScore = 0;
      this.meanPop = 0;
      this.statusMsg = `Only ${this.allEvents.length} events at M≥${this.minMag.toFixed(1)} — too few to train. Lower the threshold.`;
      this.banner.markStale(`too few events at M≥${this.minMag.toFixed(1)} — showing the last prediction`);
      return;
    }
    this.referenceTime = startOfNextUtcDay(Date.now());
    this.forecaster = new CandidateForecaster(this.allEvents, {
      minMag: this.minMag,
      maxSteps: DEFAULT_LOOKAHEAD_STEPS,
      referenceTime: this.referenceTime,
      placeEvents: this.catalog
    });
    this.candidateSince.clear();
    this.ga = initPopulation(this.allEvents, this.trainEnd, this.config());
    this.syncFromGa();
    this.updateBanner(true);
    this.refreshHoldoutAndReplay();
    this.statusMsg = "Population initialized — press Train to evolve";
  }

  private syncFromGa(): void {
    if (!this.ga) return;
    this.generation = this.ga.generation;
    this.bestTrain = this.ga.best.fitness;
    this.history = [...this.ga.history];
    const mean =
      this.ga.population.reduce((s, ind) => s + ind.fitness, 0) / this.ga.population.length;
    this.meanPop = mean;
    this.refreshCandidates();
    this.updateBanner(false);
  }

  /**
   * Offer the current best genome to the banner. Unforced offers are throttled
   * (BANNER_THROTTLE_MS) and only recompute when the best genome changed.
   */
  private updateBanner(force: boolean): void {
    if (!this.ga) return;
    const changed = this.banner.offer(
      {
        genome: this.ga.best.genome,
        fitness: this.ga.best.fitness,
        generation: this.ga.generation,
        events: this.allEvents,
        placeEvents: this.catalog,
        referenceTime: this.referenceTime,
        catalogMinMag: this.minMag
      },
      force
    );
    if (changed) this.requestUpdate();
  }

  protected updated(): void {
    // Publish after every render so the banner mirrors generation / training / stale state.
    bannerStore.publish({
      state: this.banner.state,
      generation: this.generation,
      training: this.training,
      catalogMinMag: this.minMag,
      loading: this.loading,
      error: this.error
    });
  }

  /**
   * Experimental: top-3 distinct genomes and their next M≥minMag prediction after today.
   * Cheap and cached per genome, so it runs every generation; a row only changes when
   * that candidate's genome changes.
   */
  private refreshCandidates(): void {
    if (!this.ga || !this.forecaster) return;
    const next = this.forecaster.forecast(topCandidates(this.ga.population, CANDIDATE_COUNT));
    // "In the top 3 since generation N" — only for the current members.
    const since = new Map<string, number>();
    for (const c of next) since.set(c.key, this.candidateSince.get(c.key) ?? this.ga.generation);
    this.candidateSince = since;
    const unchanged =
      next.length === this.candidates.length &&
      next.every((c, i) => c.key === this.candidates[i].key && c.fitness === this.candidates[i].fitness);
    if (!unchanged) this.candidates = next;
  }

  private refreshHoldoutAndReplay(): void {
    if (!this.ga) return;
    // Holdout: evaluate on full sequence from trainEnd..length-1 (history includes train)
    this.holdoutScore = evaluateFitness(
      this.ga.best.genome,
      this.allEvents,
      Math.max(minHistoryIndex(), this.trainEnd),
      this.allEvents.length - 1,
      undefined,
      this.minMag
    );
    // Walk-forward predictions for every event ≥ minMag in the catalog's last 90 days (holdout
    // period). Each step predicts event i+1 from history 0..i, so a lower threshold (denser
    // catalog) means more predictions on the map and in the replay.
    const idx = recentIndices(
      this.allEvents,
      RECENT_PREDICTION_DAYS,
      MIN_RECENT_PREDICTIONS,
      Math.max(minHistoryIndex() + 1, this.trainEnd)
    ).slice(-MAX_RECENT_PREDICTIONS);
    this.replaySteps = idx.length
      ? replayWindow(this.ga.best.genome, this.allEvents, idx[0] - 1, this.allEvents.length - 1)
      : [];
    this.replayIndex = 0;
  }

  private stopLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private startLoop(): void {
    this.stopLoop();
    this.lastTick = performance.now();
    const tick = (now: number) => {
      if (!this.training || !this.ga) return;
      const interval = Math.max(16, 400 / this.speed);
      if (now - this.lastTick >= interval) {
        this.lastTick = now;
        this.ga = evolveOneGeneration(this.ga, this.allEvents, this.trainEnd, this.config());
        this.syncFromGa();
        if (this.ga.generation % 5 === 0) {
          this.refreshHoldoutAndReplay();
        }
        // Advance replay animation
        if (this.replaySteps.length) {
          this.replayIndex = (this.replayIndex + 1) % this.replaySteps.length;
        }
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private onTrain = (): void => {
    if (!this.ga) return;
    this.training = true;
    this.statusMsg = "Evolving population…";
    this.startLoop();
  };

  private onPause = (): void => {
    this.training = false;
    this.stopLoop();
    this.updateBanner(true); // take any update the throttle skipped
    this.refreshHoldoutAndReplay();
    this.statusMsg = "Paused";
  };

  private onReset = (): void => {
    this.resetGa();
  };

  private genomeSummary(g: Genome): string {
    const lines: string[] = [
      `scoring tolerances (fixed, not evolved): time ${SCORE_TOLERANCES.timeLogHours} log-h · ${SCORE_TOLERANCES.distKm} km · M${SCORE_TOLERANCES.mag}`,
      "top |weights| per head (feature → weight):"
    ];
    const headNames = ["logHours", "dLat", "dLon", "mag"];
    for (let h = 0; h < HEAD_COUNT; h++) {
      const pairs: { name: string; w: number }[] = [];
      for (let i = 0; i < FEATURE_DIM; i++) {
        pairs.push({ name: FEATURE_NAMES[i], w: g.genes[h * WEIGHTS_PER_HEAD + i] });
      }
      pairs.sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
      const top = pairs
        .slice(0, 3)
        .map((p) => `${p.name}${p.w >= 0 ? "+" : ""}${p.w.toFixed(2)}`)
        .join(", ");
      const bias = g.genes[h * WEIGHTS_PER_HEAD + FEATURE_DIM];
      lines.push(`  ${headNames[h]}: bias=${bias.toFixed(2)} · ${top}`);
    }
    return lines.join("\n");
  }

  private headlineLegendMag(): string {
    const p = this.banner.state.snapshot?.forecast.prediction;
    return p ? ` · M${p.mag.toFixed(2)}` : " · none yet";
  }

  private renderBaseline() {
    const bt = this.baselineTrain;
    const bh = this.baselineHoldout;
    const p = this.baselineParams;
    if (!p || !Number.isFinite(bt) || !Number.isFinite(bh)) {
      return html`<p class="muted" data-testid="baseline">Baseline needs more events — lower the threshold.</p>`;
    }
    const skillTrain = skillVsBaseline(this.bestTrain, bt);
    const skillHold = skillVsBaseline(this.holdoutScore, bh);
    const pct = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}%`;
    const verdict =
      skillHold > 0.005
        ? html`<strong class="good">Evolution beats the dumb guess</strong> on unseen (holdout) data: it closes
            ${pct(skillHold)} of the gap between the baseline and a perfect score.`
        : skillHold < -0.005
          ? html`<strong class="bad">Evolution does worse than the dumb guess</strong> on unseen (holdout) data
              (${pct(skillHold)} of the gap to a perfect score).`
          : html`<strong>Evolution is level with the dumb guess</strong> on unseen (holdout) data.`;
    const hours = Math.expm1(p.logHours);
    return html`
      <div class="baseline" data-testid="baseline">
        <table class="forecast">
          <thead>
            <tr><th></th><th>Best genome</th><th>No-learning baseline</th><th>Skill vs baseline</th></tr>
          </thead>
          <tbody>
            <tr><td>Train</td><td>${this.bestTrain.toFixed(3)}</td><td>${bt.toFixed(3)}</td><td>${pct(skillTrain)}</td></tr>
            <tr><td>Holdout</td><td>${this.holdoutScore.toFixed(3)}</td><td>${bh.toFixed(3)}</td><td><strong>${pct(skillHold)}</strong></td></tr>
          </tbody>
        </table>
        <p style="margin:8px 0 0;font-size:0.85rem">${verdict}</p>
        <p class="muted" style="margin:6px 0 0;font-size:0.78rem">
          Baseline = no learning: next quake at the same place as the current one, after the median training gap
          (${hours < 48 ? `${hours.toFixed(1)} h` : `${(hours / 24).toFixed(1)} days`}), with the median training magnitude
          (M${p.mag.toFixed(2)}). Skill = (model − baseline) ÷ (1 − baseline): 0 = no better than the guess, 100% = perfect.
          Both are scored the same way: ${SCORE_WEIGHTS.time} × time + ${SCORE_WEIGHTS.region} × location +
          ${SCORE_WEIGHTS.mag} × magnitude, each exp(−error ÷ fixed tolerance) with tolerances
          ${SCORE_TOLERANCES.timeLogHours} log-hour, ${SCORE_TOLERANCES.distKm} km and ${SCORE_TOLERANCES.mag} M; the
          magnitude part weights each event by min(${MAG_WEIGHT.cap}, 10^(${MAG_WEIGHT.b} × (M − M${this.minMag.toFixed(1)}))) so
          missing a big quake costs more. Selection still uses only the model's own train score.
        </p>
      </div>
    `;
  }

  private renderCandidates() {
    const day = (t: number) => new Date(t).toISOString().slice(0, 10);
    const hour = (t: number) => new Date(t).toISOString().slice(0, 16).replace("T", " ");
    const none = (fc: ForecastResult) => {
      if (fc.stoppedReason === "degenerate") {
        return "Look-ahead left the data range (latitude at a pole or magnitude at the M9.5 cap).";
      }
      const next = fc.nextMag === null ? "" : ` Its next predicted event is M${fc.nextMag.toFixed(2)}.`;
      return `No M≥${this.minMag.toFixed(1)} event in its next ${fc.stepsRun} predicted events.${next}`;
    };
    const lastEvent = this.allEvents.at(-1);
    return html`
      <div class="experimental">
        <strong>${FORECAST_DISCLAIMER}</strong>
        The three fittest distinct genomes in the current population each give one prediction for the
        next M≥${this.minMag.toFixed(1)} event after today (threshold = the minimum-magnitude slider). A toy linear GA cannot predict real earthquakes.
      </div>
      ${!this.candidates.length
        ? html`<p class="muted">Candidates appear after the population initializes.</p>`
        : html`
            <table class="forecast">
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>Date (UTC)</th>
                  <th>Location</th>
                  <th>Mag</th>
                  <th>Score</th>
                </tr>
              </thead>
              <tbody>
                ${this.candidates.map((c) => {
                  const p = c.forecast.prediction;
                  const color = CANDIDATE_COLORS[c.rank - 1];
                  const since = this.candidateSince.get(c.key) ?? 0;
                  const who = html`
                    <td>
                      <span class="swatch" style="border-color:${color}">${c.rank}</span>
                      <span class="sub">#${c.key.slice(-6)}</span>
                      <div class="sub">fitness ${c.fitness.toFixed(3)} · since gen ${since}</div>
                    </td>
                  `;
                  return p
                    ? html`
                        <tr>
                          ${who}
                          <td>
                            ${hour(p.time)}
                            <div class="sub">window ${day(p.windowStart)} → ${day(p.windowEnd)}</div>
                          </td>
                          <td>
                            ${p.region}
                            <div class="sub">lat ${p.lat.toFixed(1)}, lon ${p.lon.toFixed(1)} · ±${p.radiusKm.toFixed(0)} km</div>
                          </td>
                          <td>M${p.mag.toFixed(2)}</td>
                          <td>
                            ${p.score.toFixed(2)}
                            <div class="sub">look-ahead ${p.step}</div>
                          </td>
                        </tr>
                      `
                    : html`
                        <tr>
                          ${who}
                          <td colspan="4" class="muted">${none(c.forecast)}</td>
                        </tr>
                      `;
                })}
              </tbody>
            </table>
            <p class="muted" style="margin:8px 0 0;font-size:0.8rem">
              Predictions are dated after ${day(this.referenceTime - 1)} (UTC); catalog runs to
              ${lastEvent ? hour(lastEvent.time) : "—"} UTC. Each genome predicts the next event from the real
              catalog and looks ahead up to ${DEFAULT_LOOKAHEAD_STEPS} predicted events for the first one above
              M${this.minMag.toFixed(1)}; the predicted waiting time is counted from the start of tomorrow.
              Deterministic: a row changes only when that candidate's genome changes.
              Score = P(M≥${this.minMag.toFixed(1)}) if magnitude errors followed the scorer's kernel (fixed
              ±${SCORE_TOLERANCES.mag} M); the date window (±${SCORE_TOLERANCES.timeLogHours} log-hour) and circle radius
              (${SCORE_TOLERANCES.distKm} km) are the fixed scoring tolerances, the same for every genome. None of these are calibrated.
            </p>
          `}
    `;
  }

  private replayPredictionsCache: { steps: ReplayStep[]; preds: ReplayStep["prediction"][] } | null = null;

  /** Stable array (per replay rebuild) so the map only redraws markers when they change. */
  private replayPredictions(): ReplayStep["prediction"][] {
    if (this.replayPredictionsCache?.steps !== this.replaySteps) {
      this.replayPredictionsCache = { steps: this.replaySteps, preds: this.replaySteps.map((st) => st.prediction) };
    }
    return this.replayPredictionsCache.preds;
  }

  private mapCandidates(): MapCandidate[] {
    return this.candidates.flatMap((c) => {
      const p = c.forecast.prediction;
      return p ? [{ rank: c.rank, lat: p.lat, lon: p.lon, radiusKm: p.radiusKm }] : [];
    });
  }

  /** Walk-forward (replay) predictions + candidate circles currently drawn. */
  private predictionsShown(): number {
    return this.replaySteps.length + this.mapCandidates().length;
  }

  private renderMinMag() {
    const r = this.magRange;
    const pending = this.minMagInput !== this.minMag;
    const previewEvents = countAtOrAbove(this.catalog, this.minMagInput);
    return html`
      <label for="min-mag">
        Minimum magnitude
        <span class="mag-readout">M ≥ ${this.minMagInput.toFixed(1)}</span>
      </label>
      <input
        id="min-mag"
        type="range"
        min=${String(r.min)}
        max=${String(r.max)}
        step=${String(r.step)}
        .value=${String(this.minMagInput)}
        ?disabled=${this.loading || !!this.error}
        aria-valuetext=${`M ≥ ${this.minMagInput.toFixed(1)}`}
        @input=${(e: Event) => this.onMinMagInput(Number((e.target as HTMLInputElement).value))}
        @change=${() => this.commitMinMag()}
      />
      <div class="mag-ticks"><span>M${r.min.toFixed(1)}</span><span>M${r.max.toFixed(1)}</span></div>
      <div class="mag-counts" data-testid="mag-counts">
        <strong>${fmt(previewEvents)}</strong> events ≥ M${this.minMagInput.toFixed(1)} ·
        ${pending
          ? html`<em>applying…</em>`
          : html`<strong>${fmt(this.predictionsShown())}</strong> predictions shown`}
      </div>
    `;
  }

  private currentReplay(): ReplayStep | null {
    if (!this.replaySteps.length) return null;
    return this.replaySteps[this.replayIndex % this.replaySteps.length];
  }

  render() {
    const step = this.currentReplay();
    const highlight =
      step && this.allEvents[step.index + 1] ? this.allEvents[step.index + 1] : null;
    const prediction = step?.prediction ?? null;

    return html`
      <div class="disclaimer">
        <strong>Educational disclaimer:</strong>
        Earthquake prediction in the real world is <em>not</em> a solved problem.
        <strong>quakevolve</strong> is a genetic-algorithm playground — fitness is measured by
        replaying a historical catalog and scoring how well a genome predicts the
        <em>next</em> event’s time gap, location, and magnitude. This is not operational forecasting.
      </div>

      ${this.error ? html`<p class="err">${this.error}</p>` : null}

      <div class="layout">
        <aside class="panel">
          <h2>Controls</h2>
          ${this.renderMinMag()}
          <label>Population ${this.popSize}</label>
          <input
            type="range"
            min="16"
            max="80"
            step="8"
            .value=${String(this.popSize)}
            ?disabled=${this.training}
            @input=${(e: Event) => {
              this.popSize = Number((e.target as HTMLInputElement).value);
            }}
          />
          <label>Mutation rate ${this.mutationRate.toFixed(2)}</label>
          <input
            type="range"
            min="0.02"
            max="0.4"
            step="0.02"
            .value=${String(this.mutationRate)}
            @input=${(e: Event) => {
              this.mutationRate = Number((e.target as HTMLInputElement).value);
            }}
          />
          <label>Speed ${this.speed}×</label>
          <input
            type="range"
            min="1"
            max="12"
            step="1"
            .value=${String(this.speed)}
            @input=${(e: Event) => {
              this.speed = Number((e.target as HTMLInputElement).value);
            }}
          />

          <div class="row">
            <button class="primary" ?disabled=${this.loading || this.training || !!this.error} @click=${this.onTrain}>
              Train
            </button>
            <button ?disabled=${!this.training} @click=${this.onPause}>Pause</button>
            <button ?disabled=${this.loading || !!this.error} @click=${this.onReset}>Reset</button>
          </div>

          <div class="stats">
            <div class="stat"><div class="k">Generation</div><div class="v">${this.generation}</div></div>
            <div class="stat"><div class="k">Best train</div><div class="v">${this.bestTrain.toFixed(3)}</div></div>
            <div class="stat"><div class="k">Holdout</div><div class="v">${this.holdoutScore.toFixed(3)}</div></div>
            <div class="stat"><div class="k">Pop mean</div><div class="v">${this.meanPop.toFixed(3)}</div></div>
            <div class="stat"><div class="k">Events ≥ M${this.minMag.toFixed(1)}</div><div class="v">${fmt(this.eventCount)}</div></div>
            <div class="stat"><div class="k">Train / hold</div><div class="v">${fmt(this.trainCount)} / ${fmt(this.holdoutCount)}</div></div>
            <div class="stat"><div class="k">Predictions shown</div><div class="v">${fmt(this.predictionsShown())}</div></div>
            <div class="stat"><div class="k">Replay steps</div><div class="v">${fmt(this.replaySteps.length)}</div></div>
          </div>

          <p class="edu">
            ${this.statusMsg}<br />
            Catalog: ${this.datasetMeta.source || "USGS"} ·
            <code>${this.datasetMeta.query || "bundled"}</code>
          </p>

          <h2 style="margin-top:16px">Best genome</h2>
          <div class="genome">${this.ga ? this.genomeSummary(this.ga.best.genome) : "—"}</div>
        </aside>

        <div class="stack">
          <section class="panel">
            <h2>Fitness over generations</h2>
            <qv-fitness-chart
              .history=${this.history}
              .holdout=${this.holdoutScore}
              .baseline=${Number.isFinite(this.baselineHoldout) ? this.baselineHoldout : 0}
            ></qv-fitness-chart>
            <p class="muted" style="margin:8px 0 0;font-size:0.8rem">
              Blue = best train fitness. Yellow dashed = latest holdout score. Grey dotted = no-learning baseline
              on the holdout.
            </p>
            ${this.renderBaseline()}
          </section>

          <section class="panel">
            <h2>Top ${CANDIDATE_COUNT} candidates: next M≥${this.minMag.toFixed(1)} event after today (experimental)</h2>
            ${this.renderCandidates()}
          </section>

          <section class="panel">
            <h2>Catalog map</h2>
            <qv-quake-map
              .events=${this.allEvents}
              .highlight=${highlight}
              .prediction=${prediction}
              .predictions=${this.replayPredictions()}
              .candidates=${this.mapCandidates()}
              .headline=${headlineFromSnapshot(this.banner.state.snapshot, this.banner.state.stale)}
            ></qv-quake-map>
            <p class="muted" style="margin:8px 0 0;font-size:0.8rem">
              Blue dots = ${fmt(this.eventCount)} historical M≥${this.minMag.toFixed(1)} events.
              Yellow squares = ${fmt(this.replaySteps.length)} walk-forward predictions by the best genome, one per
              M≥${this.minMag.toFixed(1)} event in the catalog's last ${RECENT_PREDICTION_DAYS} days (each made from the history
              before it). Yellow ring = current replay prediction; green = the actual event it was predicting.
              Circles = experimental candidate predictions (radius = the fixed ${SCORE_TOLERANCES.distKm} km location tolerance).
              Pink star in a white crosshair with a white ${SCORE_TOLERANCES.distKm} km ring (true scale) = the banner's headline (biggest of
              the best genome's next ${BANNER_LOOKAHEAD_STEPS} predicted events), updated together with the banner.
            </p>
            <div class="legend">
              <span data-testid="legend-headline"
                ><span class="swatch headline-swatch" style="border-color:${HEADLINE_STYLE.outline};color:${HEADLINE_STYLE.star}"
                  >★</span
                >
                Headline (banner)${this.headlineLegendMag()}</span
              >
              ${this.candidates.map(
                (c) => html`<span
                  ><span class="swatch" style="border-color:${CANDIDATE_COLORS[c.rank - 1]}">${c.rank}</span>
                  Candidate ${c.rank}${c.forecast.prediction ? "" : ` (no M≥${this.minMag.toFixed(1)} prediction)`}</span
                >`
              )}
              <span class="muted">${FORECAST_DISCLAIMER}</span>
            </div>
          </section>

          <section class="panel">
            <h2>Prediction vs actual (holdout replay)</h2>
            <p class="muted" style="margin:0 0 8px;font-size:0.8rem">
              Step ${this.replaySteps.length ? (this.replayIndex % this.replaySteps.length) + 1 : 0} of
              ${fmt(this.replaySteps.length)} · every M≥${this.minMag.toFixed(1)} event in the last
              ${RECENT_PREDICTION_DAYS} days of the catalog${this.replaySteps.length <= MIN_RECENT_PREDICTIONS
                ? ` (at least the last ${MIN_RECENT_PREDICTIONS})`
                : ""}
            </p>
            ${step
              ? html`
                  <div class="compare">
                    <div class="box">
                      <div class="k muted">Predicted</div>
                      <div>Δt bin: <strong>${TIME_BIN_LABELS[step.predTimeBin]}</strong></div>
                      <div>hours≈${hoursFromLog(step.prediction.logHours).toFixed(1)}</div>
                      <div>mag≈${step.prediction.mag.toFixed(2)} (${MAG_BIN_LABELS[step.predMagBin]})</div>
                      <div>lat ${step.prediction.lat.toFixed(1)}, lon ${step.prediction.lon.toFixed(1)}</div>
                    </div>
                    <div class="box">
                      <div class="k muted">Actual next</div>
                      <div>Δt bin: <strong>${TIME_BIN_LABELS[step.actualTimeBin]}</strong></div>
                      <div>hours≈${hoursFromLog(step.actual.logHours).toFixed(1)}</div>
                      <div>mag=${step.actual.mag.toFixed(2)} (${MAG_BIN_LABELS[step.actualMagBin]})</div>
                      <div>lat ${step.actual.lat.toFixed(1)}, lon ${step.actual.lon.toFixed(1)}</div>
                    </div>
                  </div>
                  <p class="muted" style="margin:8px 0 0;font-size:0.8rem">
                    Soft score ${step.score.total.toFixed(3)}
                    (time ${step.score.time.toFixed(2)}, region ${step.score.region.toFixed(2)}, mag ${step.score.mag.toFixed(2)})
                  </p>
                `
              : html`<p class="muted">Replay appears after the population initializes.</p>`}
          </section>
        </div>
      </div>
    `;
  }
}

customElements.define("qv-playground", QvPlayground);
