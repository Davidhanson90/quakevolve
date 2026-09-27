import { LitElement, css, html } from "lit";
import type { QuakeEvent } from "../data/types.js";
import type { Prediction } from "../model/genome.js";
import { mapPercent, wrapOffsets, type MapHeadline } from "./headline.js";

/** Distinct colours for candidate 1/2/3 (shared with the playground legend). */
export const CANDIDATE_COLORS = ["#ff5c8a", "#b388ff", "#ff9f43"] as const;

/**
 * Headline (banner) marker style: told apart from the candidates by SHAPE — a white crosshair
 * around a star in the banner's magnitude pink, a white-outlined true-scale 300 km ring (dashed
 * once it is large enough on screen) and a label pill — rather than by a new hue (candidate #1
 * is already pink).
 */
export const HEADLINE_STYLE = {
  star: "#ff6b8a",
  outline: "#ffffff",
  ringFill: "rgba(255, 107, 138, 0.14)",
  ringDash: [6, 4] as number[]
} as const;

/** Points of an n-pointed star (outer radius r, inner r·inset) centred on (x, y), first point up. */
export function starPoints(x: number, y: number, r: number, n = 5, inset = 0.45): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < n * 2; i++) {
    const rad = i % 2 === 0 ? r : r * inset;
    const a = (Math.PI * i) / n - Math.PI / 2;
    pts.push([x + Math.cos(a) * rad, y + Math.sin(a) * rad]);
  }
  return pts;
}

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

/** Dot radius / opacity for a catalog event (M4.5 dots stay small and faint). */
export function eventDotStyle(mag: number): { r: number; alpha: number } {
  return {
    r: 1 + Math.max(0, mag - 4.5) * 0.9,
    alpha: Math.min(0.8, Math.max(0.14, 0.2 + (mag - 5) * 0.15))
  };
}

export class QvQuakeMap extends LitElement {
  static properties = {
    events: { attribute: false },
    highlight: { attribute: false },
    prediction: { attribute: false },
    predictions: { attribute: false },
    candidates: { attribute: false },
    headline: { attribute: false },
    focusing: { state: true }
  };

  declare events: QuakeEvent[];
  declare highlight: QuakeEvent | null;
  declare prediction: Prediction | null;
  /** Walk-forward predictions shown as small yellow markers (one per recent event). */
  declare predictions: Prediction[];
  /** Experimental candidate predictions, drawn as geodesic circles. */
  declare candidates: MapCandidate[];
  /** The banner's headline prediction (biggest of the next 30 chained events). */
  declare headline: MapHeadline | null;
  /** Briefly true after focusHeadline() — highlights the headline marker. */
  declare focusing: boolean;
  private focusTimer: ReturnType<typeof setTimeout> | null = null;

  /** Cached catalog layer: redrawn only when the event array or canvas size changes. */
  private baseLayer: HTMLCanvasElement | null = null;
  private baseKey: { events: QuakeEvent[]; w: number; h: number; dpr: number } | null = null;

  constructor() {
    super();
    this.events = [];
    this.highlight = null;
    this.prediction = null;
    this.predictions = [];
    this.candidates = [];
    this.headline = null;
    this.focusing = false;
  }

  disconnectedCallback(): void {
    if (this.focusTimer !== null) clearTimeout(this.focusTimer);
    super.disconnectedCallback();
  }

  /** Scroll the map into view and briefly highlight the headline marker. */
  focusHeadline(): void {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    this.scrollIntoView?.({ behavior: reduce ? "auto" : "smooth", block: "center" });
    this.focusing = false;
    if (this.focusTimer !== null) clearTimeout(this.focusTimer);
    // Re-add on the next frame so the highlight animation restarts on repeated clicks.
    requestAnimationFrame(() => {
      this.focusing = true;
      this.focusTimer = setTimeout(() => {
        this.focusing = false;
        this.focusTimer = null;
      }, 2600);
    });
  }

  static styles = css`
    :host {
      display: block;
    }
    .wrap {
      position: relative;
    }
    canvas {
      display: block;
      width: 100%;
      height: 280px;
      border-radius: 8px;
      background: #0a1220;
    }
    /* Headline pulse / focus highlight: a DOM ring over the canvas marker (CSS handles motion). */
    .hl {
      position: absolute;
      width: 30px;
      height: 30px;
      margin: -15px 0 0 -15px;
      border-radius: 50%;
      pointer-events: none;
    }
    .hl.pulse {
      border: 2px solid rgba(255, 107, 138, 0.9);
      animation: hl-pulse 2s ease-out infinite;
    }
    .hl.stale {
      animation: none;
      opacity: 0.4;
    }
    .hl.focus {
      width: 44px;
      height: 44px;
      margin: -22px 0 0 -22px;
      border: 3px solid #ffffff;
      box-shadow: 0 0 0 4px rgba(255, 107, 138, 0.6), 0 0 18px 6px rgba(255, 107, 138, 0.55);
      animation: hl-focus 0.65s ease-in-out 4 alternate;
    }
    @keyframes hl-pulse {
      0% {
        transform: scale(0.5);
        opacity: 0.95;
      }
      100% {
        transform: scale(2.2);
        opacity: 0;
      }
    }
    @keyframes hl-focus {
      from {
        transform: scale(0.8);
      }
      to {
        transform: scale(1.25);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .hl.pulse,
      .hl.focus {
        animation: none;
      }
      .hl.pulse {
        opacity: 0.6;
      }
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

    ctx.drawImage(this.catalogLayer(w, h, dpr), 0, 0, w, h);

    // Walk-forward predictions for the recent window (count grows as the threshold drops).
    const preds = this.predictions ?? [];
    ctx.fillStyle = "rgba(240, 180, 41, 0.55)";
    for (const p of preds) {
      const { x, y } = this.project(p.lat, p.lon, w, h);
      ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
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

    if (this.headline) this.drawHeadline(ctx, this.headline, w, h);

    if (this.highlight) {
      const { x, y } = this.project(this.highlight.lat, this.highlight.lon, w, h);
      ctx.strokeStyle = "#3dd68c";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /** Headline marker: white crosshair, pink star, white 300 km geodesic ring and a label pill. */
  private drawHeadline(ctx: CanvasRenderingContext2D, hl: MapHeadline, w: number, h: number): void {
    ctx.save();
    ctx.globalAlpha = hl.stale ? 0.55 : 1;
    const ring = geodesicCircle(hl.lat, hl.lon, hl.radiusKm).map(([la, lo]) => this.project(la, lo, w, h));
    const c = this.project(hl.lat, hl.lon, w, h);
    const reach = Math.max(18, ...ring.map((p) => Math.abs(p.x - c.x)));
    // Ring radius on screen: 300 km is only ~5 px at this map scale near the equator, so the ring
    // is drawn on top of the star (dashed only once it's big enough for dashes to read).
    const ringPx = Math.max(...ring.map((p) => Math.hypot(p.x - c.x, p.y - c.y)));
    const ringDy = Math.max(...ring.map((p) => Math.abs(p.y - c.y)));
    for (const shift of wrapOffsets(c.x, reach, w)) {
      const x = c.x + shift;
      const y = c.y;
      // Crosshair arms (dark halo first so it reads on bright dots), with a gap around the star.
      // Arms hug the star; near the poles the ring is a wide flat ellipse, so size the gap from its
      // (small) vertical radius and cap it so the arms never float away from the centre.
      const gap = Math.min(14, Math.max(9, ringDy + 3));
      const arm = gap + 8;
      const arms: [number, number, number, number][] = [
        [x - arm, y, x - gap, y],
        [x + gap, y, x + arm, y],
        [x, y - arm, x, y - gap],
        [x, y + gap, x, y + arm]
      ];
      for (const [width, color] of [
        [4, "rgba(10, 18, 32, 0.9)"],
        [2, HEADLINE_STYLE.outline]
      ] as const) {
        ctx.lineWidth = width;
        ctx.strokeStyle = color;
        ctx.beginPath();
        for (const [x1, y1, x2, y2] of arms) {
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
        }
        ctx.stroke();
      }
      ctx.beginPath();
      starPoints(x, y, 6.5).forEach(([px, py], k) => (k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
      ctx.closePath();
      ctx.fillStyle = HEADLINE_STYLE.star;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(10, 18, 32, 0.9)";
      ctx.stroke();

      // Geodesic tolerance ring (true scale; unwrapped longitudes, so shifting keeps it continuous).
      const tracePath = () => {
        ctx.beginPath();
        ring.forEach((pt, k) => (k === 0 ? ctx.moveTo(pt.x + shift, pt.y) : ctx.lineTo(pt.x + shift, pt.y)));
        ctx.closePath();
      };
      tracePath();
      ctx.fillStyle = HEADLINE_STYLE.ringFill;
      ctx.fill();
      ctx.setLineDash(ringPx > 12 ? HEADLINE_STYLE.ringDash : []);
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(10, 18, 32, 0.75)";
      ctx.stroke();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = HEADLINE_STYLE.outline;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Label pill beside the primary marker, flipped left near the right edge, kept inside vertically.
    ctx.font = "bold 11px system-ui, sans-serif";
    const tw = ctx.measureText(hl.label).width;
    const pw = tw + 12;
    const ph = 18;
    const right = c.x + 20 + pw <= w - 2;
    const lx = right ? c.x + 20 : c.x - 20 - pw;
    const ly = Math.min(h - ph - 2, Math.max(2, c.y - 24));
    ctx.fillStyle = "rgba(10, 18, 32, 0.88)";
    ctx.strokeStyle = HEADLINE_STYLE.star;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(lx, ly, pw, ph);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = HEADLINE_STYLE.outline;
    ctx.textBaseline = "middle";
    ctx.fillText(hl.label, lx + 6, ly + ph / 2 + 0.5);
    ctx.textBaseline = "alphabetic";
    ctx.restore();
  }

  /** All catalog events (no subsampling) pre-rendered once per event set / canvas size. */
  private catalogLayer(w: number, h: number, dpr: number): HTMLCanvasElement {
    const k = this.baseKey;
    if (this.baseLayer && k && k.events === this.events && k.w === w && k.h === h && k.dpr === dpr) {
      return this.baseLayer;
    }
    const layer = this.baseLayer ?? document.createElement("canvas");
    layer.width = Math.max(1, Math.floor(w * dpr));
    layer.height = Math.max(1, Math.floor(h * dpr));
    const ctx = layer.getContext("2d");
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      for (const ev of this.events) {
        const { x, y } = this.project(ev.lat, ev.lon, w, h);
        const { r, alpha } = eventDotStyle(ev.mag);
        ctx.fillStyle = `rgba(91, 157, 255, ${alpha.toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    this.baseLayer = layer;
    this.baseKey = { events: this.events, w, h, dpr };
    return layer;
  }

  render() {
    const hl = this.headline;
    const pos = hl ? mapPercent(hl.lat, hl.lon) : null;
    return html`<div class="wrap">
      <canvas aria-label="Earthquake map"></canvas>
      ${hl && pos
        ? html`<div
            class="hl ${this.focusing ? "focus" : "pulse"} ${hl.stale && !this.focusing ? "stale" : ""}"
            data-testid="headline-marker"
            data-lat=${hl.lat.toFixed(3)}
            data-lon=${hl.lon.toFixed(3)}
            data-mag=${hl.mag.toFixed(2)}
            style="left:${pos.left.toFixed(3)}%;top:${pos.top.toFixed(3)}%"
            aria-hidden="true"
          ></div>`
        : null}
    </div>`;
  }
}

customElements.define("qv-quake-map", QvQuakeMap);
