import { LitElement, css, html } from "lit";
import type { QuakeEvent } from "../data/types.js";
import type { Prediction } from "../model/genome.js";
import type { QuakeForecast } from "../model/forecast.js";

export class QvQuakeMap extends LitElement {
  static properties = {
    events: { attribute: false },
    highlight: { attribute: false },
    prediction: { attribute: false },
    forecasts: { attribute: false }
  };

  declare events: QuakeEvent[];
  declare highlight: QuakeEvent | null;
  declare prediction: Prediction | null;
  /** Experimental top-N rollout points (drawn as numbered diamonds). */
  declare forecasts: QuakeForecast[];

  constructor() {
    super();
    this.events = [];
    this.highlight = null;
    this.prediction = null;
    this.forecasts = [];
  }

  static styles = css`
    :host {
      display: block;
    }
    canvas {
      width: 100%;
      height: 280px;
      border-radius: 8px;
      background: #0a1220;
    }
  `;

  private project(lat: number, lon: number, w: number, h: number): { x: number; y: number } {
    // Equirectangular
    const x = ((lon + 180) / 360) * w;
    const y = ((90 - lat) / 180) * h;
    return { x, y };
  }

  protected updated(): void {
    const canvas = this.renderRoot.querySelector("canvas");
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0a1220";
    ctx.fillRect(0, 0, w, h);

    // Simple graticule
    ctx.strokeStyle = "rgba(90, 120, 160, 0.25)";
    ctx.lineWidth = 1;
    for (let lon = -180; lon <= 180; lon += 30) {
      const { x } = this.project(0, lon, w, h);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      const { y } = this.project(lat, 0, w, h);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    const maxDraw = Math.min(this.events.length, 2500);
    const step = Math.max(1, Math.floor(this.events.length / maxDraw));
    for (let i = 0; i < this.events.length; i += step) {
      const ev = this.events[i];
      const { x, y } = this.project(ev.lat, ev.lon, w, h);
      const r = 1.2 + Math.max(0, ev.mag - 5) * 1.1;
      const alpha = 0.25 + Math.min(0.55, (ev.mag - 5) * 0.15);
      ctx.fillStyle = `rgba(91, 157, 255, ${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    if (this.prediction) {
      const { x, y } = this.project(this.prediction.lat, this.prediction.lon, w, h);
      ctx.strokeStyle = "#f0b429";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(240, 180, 41, 0.35)";
      ctx.fill();
    }

    for (const f of this.forecasts ?? []) {
      const { x, y } = this.project(f.lat, f.lon, w, h);
      const s = 6;
      ctx.strokeStyle = "#ff6b8a";
      ctx.fillStyle = "rgba(255, 107, 138, 0.3)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y - s);
      ctx.lineTo(x + s, y);
      ctx.lineTo(x, y + s);
      ctx.lineTo(x - s, y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ffd1dc";
      ctx.font = "10px ui-monospace, monospace";
      ctx.fillText(String(f.rank), x + s + 2, y - s + 2);
    }

    if (this.highlight) {
      const { x, y } = this.project(this.highlight.lat, this.highlight.lon, w, h);
      ctx.strokeStyle = "#3dd68c";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  render() {
    return html`<canvas aria-label="Earthquake map"></canvas>`;
  }
}

customElements.define("qv-quake-map", QvQuakeMap);
