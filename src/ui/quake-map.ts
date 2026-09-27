import { LitElement, css, html } from "lit";
import type { QuakeEvent } from "../data/types.js";
import type { Prediction } from "../model/genome.js";

/** Distinct colours for candidate 1/2/3 (shared with the playground legend). */
export const CANDIDATE_COLORS = ["#ff5c8a", "#b388ff", "#ff9f43"] as const;

export interface MapCandidate {
  rank: number;
  lat: number;
  lon: number;
  /** Real geographic radius in km (drawn as a geodesic circle). */
  radiusKm: number;
}

const EARTH_RADIUS_KM = 6371;

/**
 * Points of a geodesic circle (destination-point formula). Longitudes are unwrapped around
 * the centre so the ring stays continuous across the antimeridian.
 */
export function geodesicCircle(lat: number, lon: number, radiusKm: number, segments = 72): [number, number][] {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const φ1 = toRad(lat);
  const λ1 = toRad(lon);
  const δ = radiusKm / EARTH_RADIUS_KM;
  const pts: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const θ = (2 * Math.PI * i) / segments;
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
    const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
    let dLon = toDeg(λ2) - lon;
    dLon = ((((dLon + 180) % 360) + 360) % 360) - 180;
    pts.push([toDeg(φ2), lon + dLon]);
  }
  return pts;
}

export class QvQuakeMap extends LitElement {
  static properties = {
    events: { attribute: false },
    highlight: { attribute: false },
    prediction: { attribute: false },
    candidates: { attribute: false }
  };

  declare events: QuakeEvent[];
  declare highlight: QuakeEvent | null;
  declare prediction: Prediction | null;
  /** Experimental candidate predictions, drawn as geodesic circles. */
  declare candidates: MapCandidate[];

  constructor() {
    super();
    this.events = [];
    this.highlight = null;
    this.prediction = null;
    this.candidates = [];
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

    for (const c of this.candidates ?? []) {
      const color = CANDIDATE_COLORS[(c.rank - 1) % CANDIDATE_COLORS.length];
      const ring = geodesicCircle(c.lat, c.lon, c.radiusKm).map(([la, lo]) => this.project(la, lo, w, h));
      const centre = this.project(c.lat, c.lon, w, h);
      // Draw at -w, 0, +w so rings crossing the antimeridian wrap onto the other edge.
      for (const shift of [-w, 0, w]) {
        ctx.beginPath();
        ring.forEach((pt, k) => (k === 0 ? ctx.moveTo(pt.x + shift, pt.y) : ctx.lineTo(pt.x + shift, pt.y)));
        ctx.closePath();
        ctx.fillStyle = `${color}26`;
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(centre.x, centre.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
      // Label just outside the ring at a rank-specific bearing so overlapping circles stay readable.
      const bearing = ((c.rank - 1) * 120 * Math.PI) / 180;
      const edge = ring[Math.round(((c.rank - 1) * 120) / 5) % ring.length];
      const lx = edge.x + Math.sin(bearing) * 8;
      const ly = edge.y - Math.cos(bearing) * 8;
      ctx.font = "bold 12px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(c.rank), lx, ly);
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";
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
