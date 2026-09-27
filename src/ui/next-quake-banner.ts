import { LitElement, css, html } from "lit";
import { keyed } from "lit/directives/keyed.js";
import {
  BANNER_LOOKAHEAD_STEPS,
  BANNER_MIN_MAG,
  bannerFallbackText,
  relativeTimeHint
} from "../model/banner.js";
import { FORECAST_DISCLAIMER } from "../model/forecast.js";
import { bannerStore, type BannerView } from "./banner-store.js";

const utc = (t: number) => `${new Date(t).toISOString().slice(0, 16).replace("T", " ")} UTC`;
const day = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * Sticky headline: the best genome's next predicted M≥6.0 event after today.
 * Never renders an empty state — loading / fallback / stale values instead.
 */
export class QvNextQuakeBanner extends LitElement {
  static properties = {
    view: { state: true }
  };

  declare view: BannerView;
  private unsubscribe: (() => void) | null = null;
  private clock: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super();
    this.view = bannerStore.get();
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribe = bannerStore.subscribe((v) => {
      this.view = v;
    });
    // Keep the "in ~N days" hint fresh even when nothing else changes.
    this.clock = setInterval(() => this.requestUpdate(), 60_000);
  }

  disconnectedCallback(): void {
    this.unsubscribe?.();
    if (this.clock !== null) clearInterval(this.clock);
    super.disconnectedCallback();
  }

  static styles = css`
    :host {
      display: block;
      position: sticky;
      top: 0;
      z-index: 50;
      --bn-bg: color-mix(in srgb, var(--qv-accent, #5b9dff) 14%, var(--qv-panel, #101827));
      --bn-edge: color-mix(in srgb, var(--qv-danger, #ff6b8a) 55%, var(--qv-border, #2a3b55));
      --bn-flash: color-mix(in srgb, var(--qv-warn, #f0b429) 28%, transparent);
    }
    .bar {
      background: linear-gradient(
          100deg,
          color-mix(in srgb, var(--qv-danger, #ff6b8a) 16%, transparent) 0%,
          transparent 45%
        ),
        var(--bn-bg);
      border-bottom: 2px solid var(--bn-edge);
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
      backdrop-filter: blur(6px);
    }
    .inner {
      max-width: 1100px;
      margin: 0 auto;
      padding: 12px 16px 10px;
      transition: opacity 0.25s ease;
    }
    .inner.stale {
      opacity: 0.55;
    }
    .top {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 6px 12px;
      font-size: 0.74rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--qv-muted, #9aa8bc);
    }
    .top .title {
      color: var(--qv-danger, #ff6b8a);
      font-weight: 700;
    }
    .pill {
      text-transform: none;
      letter-spacing: 0;
      font-size: 0.75rem;
      padding: 1px 8px;
      border-radius: 999px;
      border: 1px solid var(--qv-border, #2a3b55);
      color: var(--qv-text, #e8eef7);
    }
    .pill.live {
      border-color: var(--qv-success, #3dd68c);
    }
    .pill.updating {
      border-color: var(--qv-warn, #f0b429);
      color: var(--qv-warn, #f0b429);
    }
    .main {
      display: grid;
      grid-template-columns: minmax(0, 1.25fr) auto minmax(0, 1.5fr);
      gap: 4px 28px;
      align-items: end;
      margin-top: 6px;
      border-radius: 8px;
      min-height: 84px;
    }
    .main.flash {
      animation: flash 0.9s ease-out;
    }
    @media (prefers-reduced-motion: reduce) {
      .main.flash {
        animation: none;
      }
    }
    @keyframes flash {
      0% {
        background: var(--bn-flash);
        box-shadow: 0 0 0 6px var(--bn-flash);
      }
      100% {
        background: transparent;
        box-shadow: 0 0 0 6px transparent;
      }
    }
    .k {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--qv-muted, #9aa8bc);
    }
    .big {
      font-size: clamp(1.25rem, 2.6vw, 1.9rem);
      font-weight: 700;
      line-height: 1.15;
      font-variant-numeric: tabular-nums;
      color: var(--qv-text, #e8eef7);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .mag {
      font-size: clamp(1.8rem, 4vw, 2.8rem);
      color: var(--qv-danger, #ff6b8a);
    }
    .sub {
      font-size: 0.82rem;
      color: var(--qv-muted, #9aa8bc);
      font-variant-numeric: tabular-nums;
    }
    .fallback {
      grid-column: 1 / -1;
      align-self: center;
      font-size: clamp(1.05rem, 2.2vw, 1.4rem);
      font-weight: 600;
      color: var(--qv-text, #e8eef7);
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 14px;
      margin-top: 8px;
      font-size: 0.78rem;
      color: var(--qv-muted, #9aa8bc);
      font-variant-numeric: tabular-nums;
    }
    .meta strong {
      color: var(--qv-text, #e8eef7);
      font-weight: 600;
    }
    .disclaimer {
      /* Amber pulled toward the text colour: readable on both the dark and light theme. */
      color: color-mix(in srgb, var(--qv-warn, #f0b429) 70%, var(--qv-text, #e8eef7));
    }
    /* Narrow screens: compact two-row layout so the sticky bar stays short. */
    @media (max-width: 720px) {
      .inner {
        padding: 6px 12px 6px;
      }
      .top {
        font-size: 0.68rem;
      }
      .main {
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 0 12px;
        margin-top: 2px;
        min-height: 0;
      }
      .where {
        grid-column: 1 / -1;
      }
      .k,
      .win,
      .magsub,
      .meta .extra {
        display: none;
      }
      .big {
        font-size: 1.05rem;
      }
      .mag {
        font-size: 1.6rem;
      }
      .where .big {
        white-space: normal;
      }
      .sub {
        font-size: 0.74rem;
      }
      .meta {
        margin-top: 2px;
        gap: 0 10px;
        font-size: 0.7rem;
      }
      .fallback {
        font-size: 0.95rem;
      }
    }
    /* Very short viewports (landscape phones): don't pin it over the content. */
    @media (max-height: 520px) {
      :host {
        position: relative;
      }
    }
  `;

  private renderBody() {
    const v = this.view;
    const snap = v.state.snapshot;
    if (!snap) {
      const msg = v.error
        ? `Catalog failed to load: ${v.error}`
        : "Loading catalog and evolving the first population…";
      return html`<div class="main"><div class="fallback">${msg}</div></div>`;
    }
    const p = snap.forecast.prediction;
    const main = p
      ? html`
          <div class="when">
            <div class="k">When</div>
            <div class="big" data-testid="banner-when">${utc(p.time)}</div>
            <div class="sub">
              ${relativeTimeHint(p.time, Date.now())}<span class="win"> · window ${day(p.windowStart)} → ${day(p.windowEnd)}</span>
            </div>
          </div>
          <div class="magcell">
            <div class="k">Magnitude</div>
            <div class="big mag" data-testid="banner-mag">M${p.mag.toFixed(2)}</div>
            <div class="sub magsub">P(M≥${BANNER_MIN_MAG.toFixed(1)}) ${p.score.toFixed(2)} (uncalibrated)</div>
          </div>
          <div class="where">
            <div class="k">Where</div>
            <div class="big" data-testid="banner-where" title=${p.region}>${p.region}</div>
            <div class="sub">lat ${p.lat.toFixed(1)}, lon ${p.lon.toFixed(1)} · ±${p.radiusKm.toFixed(0)} km</div>
          </div>
        `
      : html`<div class="fallback" data-testid="banner-fallback">${bannerFallbackText(snap.forecast)}</div>`;
    return keyed(
      snap.version,
      html`<div class="main ${snap.version > 1 ? "flash" : ""}" data-version=${snap.version}>${main}</div>`
    );
  }

  render() {
    const v = this.view;
    const snap = v.state.snapshot;
    const stale = v.state.stale;
    const statusPill = stale
      ? html`<span class="pill updating">${v.state.staleReason || "updating…"}</span>`
      : v.training
        ? html`<span class="pill live">live · updating as the model improves</span>`
        : snap
          ? html`<span class="pill">paused · press Train to improve</span>`
          : null;
    return html`
      <div class="bar" role="status" aria-live="polite">
        <div class="inner ${stale ? "stale" : ""}">
          <div class="top">
            <span class="title">Next M${BANNER_MIN_MAG.toFixed(1)}+ event · model prediction</span>
            ${statusPill}
          </div>
          ${this.renderBody()}
          <div class="meta">
            ${snap
              ? html`
                  <span>Best genome <strong>#${snap.key.slice(-6)}</strong></span>
                  <span>fitness <strong>${snap.fitness.toFixed(3)}</strong></span>
                  <span>best since gen <strong>${snap.foundGeneration}</strong> (now ${v.generation})</span>
                  <span class="extra">trained on M≥${snap.catalogMinMag.toFixed(1)} catalog · look-ahead ${BANNER_LOOKAHEAD_STEPS} events · after today (UTC)</span>
                `
              : null}
            <span class="disclaimer">${FORECAST_DISCLAIMER} Toy GA output.</span>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define("qv-next-quake-banner", QvNextQuakeBanner);
