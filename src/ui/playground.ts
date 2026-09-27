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
  FORECAST_DISCLAIMER,
  forecastBigQuakes,
  type ForecastResult
} from "../model/forecast.js";
import {
  DEFAULT_GA_CONFIG,
  evolveOneGeneration,
  initPopulation,
  type GaConfig,
  type GaState
} from "../ga/evolve.js";
import "./fitness-chart.js";
import "./quake-map.js";

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
    forecast: { state: true },
    forecastGeneration: { state: true }
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
  declare forecast: ForecastResult | null;
  declare forecastGeneration: number;

  private allEvents: QuakeEvent[] = [];
  /** Exclusive end index of the train prefix within allEvents. */
  private trainEnd = 0;
  private ga: GaState | null = null;
  private rafId: number | null = null;
  private lastTick = 0;
  private replaySteps: ReplayStep[] = [];
  private datasetMeta = { source: "", query: "" };

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
    this.forecast = null;
    this.forecastGeneration = 0;
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
    // Experimental: roll the current best genome past the catalog end for the top-5 M>6 list
    this.forecast = forecastBigQuakes(this.ga.best.genome, this.allEvents, {
      minMag: BIG_QUAKE_MAG,
      count: 5
    });
    this.forecastGeneration = this.ga.generation;
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

  private renderForecast() {
    const fc = this.forecast;
    const day = (t: number) => new Date(t).toISOString().slice(0, 10);
    const stopNote: Record<ForecastResult["stoppedReason"], string> = {
      found: "",
      maxSteps: "the rollout step limit was reached",
      horizon: "the one-year horizon was reached",
      degenerate: "the rollout saturated (latitude pinned at a pole or magnitude at the M9.5 cap) and was stopped"
    };
    return html`
      <div class="experimental">
        <strong>${FORECAST_DISCLAIMER}</strong>
        The current best genome is rolled forward from the last catalog event, feeding each
        predicted event back in as history. A toy GA on a 2018–2024 snapshot cannot predict
        real earthquakes.
      </div>
      ${!fc
        ? html`<p class="muted">Predictions appear after the population initializes.</p>`
        : html`
            ${fc.forecasts.length
              ? html`
                  <table class="forecast">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Date (UTC)</th>
                        <th>Location</th>
                        <th>Mag</th>
                        <th>Self-score</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${fc.forecasts.map(
                        (f) => html`
                          <tr>
                            <td>${f.rank}</td>
                            <td>
                              ${day(f.time)}
                              <div class="sub">window ${day(f.windowStart)} → ${day(f.windowEnd)}</div>
                            </td>
                            <td>
                              ${f.region}
                              <div class="sub">
                                lat ${f.lat.toFixed(1)}, lon ${f.lon.toFixed(1)} · ±${f.radiusKm.toFixed(0)} km
                              </div>
                            </td>
                            <td>M${f.mag.toFixed(2)}</td>
                            <td>
                              ${f.score.toFixed(2)}
                              <div class="sub">step ${f.step}</div>
                            </td>
                          </tr>
                        `
                      )}
                    </tbody>
                  </table>
                `
              : html`<p class="muted">
                  The current best genome predicts no M&gt;${BIG_QUAKE_MAG.toFixed(1)} events in its rollout.
                </p>`}
            <p class="muted" style="margin:8px 0 0;font-size:0.8rem">
              Generation ${this.forecastGeneration} · refreshed every 5 generations while training ·
              predictions after the last catalog event (${day(fc.anchorTime)}), so dates may already be in the past.
              ${fc.forecasts.length < 5 && fc.stoppedReason !== "found"
                ? html`Only ${fc.forecasts.length} found: ${stopNote[fc.stoppedReason]} after ${fc.stepsRun} steps.`
                : null}
              Self-score = P(M&gt;${BIG_QUAKE_MAG.toFixed(1)}) under the genome's own magnitude tolerance gene;
              window and radius come from its time and distance tolerance genes. None of these are calibrated.
            </p>
          `}
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
            <h2>Next 5 predicted M&gt;${BIG_QUAKE_MAG.toFixed(1)} events (experimental)</h2>
            ${this.renderForecast()}
          </section>

          <section class="panel">
            <h2>Catalog map</h2>
            <qv-quake-map
              .events=${this.allEvents}
              .highlight=${highlight}
              .prediction=${prediction}
              .forecasts=${this.forecast?.forecasts ?? []}
            ></qv-quake-map>
            <p class="muted" style="margin:8px 0 0;font-size:0.8rem">
              Blue dots = historical M≥5.5 events. Yellow ring = model prediction; green = actual next event (replay).
              Numbered red diamonds = experimental top-5 M&gt;${BIG_QUAKE_MAG.toFixed(1)} rollout (not a forecast).
            </p>
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
