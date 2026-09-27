import { LitElement, css, html } from "lit";
import { loadEarthquakes, trainHoldoutSplit } from "../data/load.js";
import type { QuakeEvent } from "../data/types.js";
import {
  FEATURE_DIM,
  FEATURE_NAMES,
  TIME_BIN_LABELS,
  MAG_BIN_LABELS,
  hoursFromLog,
  minHistoryIndex
} from "../features/extract.js";
import { HEAD_COUNT, WEIGHTS_PER_HEAD, decodeTolerances, type Genome } from "../model/genome.js";
import { evaluateFitness, replayWindow, type ReplayStep } from "../model/score.js";
import {
  BIG_QUAKE_MAG,
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
import "./fitness-chart.js";
import { CANDIDATE_COLORS, type MapCandidate } from "./quake-map.js";

export class QvPlayground extends LitElement {
  static properties = {
    loading: { state: true },
    error: { state: true },
    training: { state: true },
    generation: { state: true },
    bestTrain: { state: true },
    holdoutScore: { state: true },
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
    candidates: { state: true }
  };

  declare loading: boolean;
  declare error: string;
  declare training: boolean;
  declare generation: number;
  declare bestTrain: number;
  declare holdoutScore: number;
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
    void this.bootstrap();
  }

  disconnectedCallback(): void {
    this.stopLoop();
    super.disconnectedCallback();
  }

  private async bootstrap(): Promise<void> {
    try {
      const ds = await loadEarthquakes();
      this.allEvents = ds.events;
      this.datasetMeta = { source: ds.source, query: ds.query };
      const { train, holdout } = trainHoldoutSplit(this.allEvents, 0.7);
      this.trainEnd = train.length;
      this.eventCount = this.allEvents.length;
      this.trainCount = train.length;
      this.holdoutCount = holdout.length;
      this.resetGa();
      this.loading = false;
      this.statusMsg = `Loaded ${ds.count} events · train ${train.length} / holdout ${holdout.length}`;
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
      mutationRate: this.mutationRate
    };
  }

  private resetGa(): void {
    this.stopLoop();
    this.training = false;
    if (this.allEvents.length < minHistoryIndex() + 4) return;
    this.referenceTime = startOfNextUtcDay(Date.now());
    this.forecaster = new CandidateForecaster(this.allEvents, {
      minMag: BIG_QUAKE_MAG,
      maxSteps: DEFAULT_LOOKAHEAD_STEPS,
      referenceTime: this.referenceTime
    });
    this.candidateSince.clear();
    this.ga = initPopulation(this.allEvents, this.trainEnd, this.config());
    this.syncFromGa();
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
  }

  /**
   * Experimental: top-3 distinct genomes and their next M>6 prediction after today.
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
      this.allEvents.length - 1
    );
    // Replay a window near the train/holdout boundary for prediction vs actual
    const from = Math.max(minHistoryIndex(), this.trainEnd - 1);
    const to = Math.min(this.allEvents.length - 1, this.trainEnd + 40);
    this.replaySteps = replayWindow(this.ga.best.genome, this.allEvents, from, to);
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
    this.refreshHoldoutAndReplay();
    this.statusMsg = "Paused";
  };

  private onReset = (): void => {
    this.resetGa();
  };

  private genomeSummary(g: Genome): string {
    const tol = decodeTolerances(g);
    const lines: string[] = [
      `tol: time=${tol.timeTol.toFixed(2)}  distKm=${tol.distTolKm.toFixed(0)}  mag=${tol.magTol.toFixed(2)}`,
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

  private renderCandidates() {
    const day = (t: number) => new Date(t).toISOString().slice(0, 10);
    const hour = (t: number) => new Date(t).toISOString().slice(0, 16).replace("T", " ");
    const none = (fc: ForecastResult) => {
      if (fc.stoppedReason === "degenerate") {
        return "Look-ahead left the data range (latitude at a pole or magnitude at the M9.5 cap).";
      }
      const next = fc.nextMag === null ? "" : ` Its next predicted event is M${fc.nextMag.toFixed(2)}.`;
      return `No M>${BIG_QUAKE_MAG.toFixed(1)} event in its next ${fc.stepsRun} predicted events.${next}`;
    };
    const lastEvent = this.allEvents.at(-1);
    return html`
      <div class="experimental">
        <strong>${FORECAST_DISCLAIMER}</strong>
        The three fittest distinct genomes in the current population each give one prediction for the
        next M&gt;${BIG_QUAKE_MAG.toFixed(1)} event after today. A toy linear GA cannot predict real earthquakes.
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
              M${BIG_QUAKE_MAG.toFixed(1)}; the predicted waiting time is counted from the start of tomorrow.
              Deterministic: a row changes only when that candidate's genome changes.
              Score = P(M&gt;${BIG_QUAKE_MAG.toFixed(1)}) under the genome's own magnitude tolerance gene; window and
              circle radius come from its time and distance tolerance genes. None of these are calibrated.
            </p>
          `}
    `;
  }

  private mapCandidates(): MapCandidate[] {
    return this.candidates.flatMap((c) => {
      const p = c.forecast.prediction;
      return p ? [{ rank: c.rank, lat: p.lat, lon: p.lon, radiusKm: p.radiusKm }] : [];
    });
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
            <div class="stat"><div class="k">Events</div><div class="v">${this.eventCount}</div></div>
            <div class="stat"><div class="k">Train / hold</div><div class="v">${this.trainCount} / ${this.holdoutCount}</div></div>
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
            <qv-fitness-chart .history=${this.history} .holdout=${this.holdoutScore}></qv-fitness-chart>
            <p class="muted" style="margin:8px 0 0;font-size:0.8rem">
              Blue = best train fitness. Yellow dashed = latest holdout soft-score.
            </p>
          </section>

          <section class="panel">
            <h2>Top ${CANDIDATE_COUNT} candidates: next M&gt;${BIG_QUAKE_MAG.toFixed(1)} event after today (experimental)</h2>
            ${this.renderCandidates()}
          </section>

          <section class="panel">
            <h2>Catalog map</h2>
            <qv-quake-map
              .events=${this.allEvents}
              .highlight=${highlight}
              .prediction=${prediction}
              .candidates=${this.mapCandidates()}
            ></qv-quake-map>
            <p class="muted" style="margin:8px 0 0;font-size:0.8rem">
              Blue dots = historical M≥5.5 events. Yellow ring = model prediction; green = actual next event (replay).
              Circles = experimental candidate predictions (radius = that genome's location tolerance, in km).
            </p>
            <div class="legend">
              ${this.candidates.map(
                (c) => html`<span
                  ><span class="swatch" style="border-color:${CANDIDATE_COLORS[c.rank - 1]}">${c.rank}</span>
                  Candidate ${c.rank}${c.forecast.prediction ? "" : " (no M>6 prediction)"}</span
                >`
              )}
              <span class="muted">${FORECAST_DISCLAIMER}</span>
            </div>
          </section>

          <section class="panel">
            <h2>Prediction vs actual (holdout replay)</h2>
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
