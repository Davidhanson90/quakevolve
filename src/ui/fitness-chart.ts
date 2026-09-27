import { LitElement, css, html } from "lit";

export class QvFitnessChart extends LitElement {
  static properties = {
    history: { attribute: false },
    holdout: { type: Number },
    baseline: { type: Number }
  };

  declare history: number[];
  declare holdout: number;
  /** No-learning baseline score on the holdout (0 = hidden). */
  declare baseline: number;

  constructor() {
    super();
    this.history = [];
    this.holdout = 0;
    this.baseline = 0;
  }

  static styles = css`
    :host {
      display: block;
    }
    canvas {
      width: 100%;
      height: 160px;
      border-radius: 8px;
      background: rgba(0, 0, 0, 0.2);
    }
  `;

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
    ctx.clearRect(0, 0, w, h);

    const hist = this.history.length ? this.history : [0];
    const maxY = Math.max(0.2, ...hist, this.holdout, this.baseline, 0.01);
    const minY = 0;

    // Holdout reference line
    if (this.holdout > 0) {
      const y = h - ((this.holdout - minY) / (maxY - minY)) * (h - 16) - 8;
      ctx.strokeStyle = "rgba(240, 180, 41, 0.7)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(8, y);
      ctx.lineTo(w - 8, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(240, 180, 41, 0.9)";
      ctx.font = "11px system-ui";
      ctx.fillText("holdout", w - 58, Math.max(12, y - 4));
    }

    // No-learning baseline reference line
    if (this.baseline > 0) {
      const y = h - ((this.baseline - minY) / (maxY - minY)) * (h - 16) - 8;
      ctx.strokeStyle = "rgba(154, 168, 188, 0.85)";
      ctx.setLineDash([1, 3]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(8, y);
      ctx.lineTo(w - 8, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(154, 168, 188, 0.95)";
      ctx.font = "11px system-ui";
      ctx.fillText("baseline", 12, Math.max(12, y - 4));
    }

    ctx.strokeStyle = "#5b9dff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    hist.forEach((v, i) => {
      const x = 8 + (i / Math.max(1, hist.length - 1)) * (w - 16);
      const y = h - ((v - minY) / (maxY - minY)) * (h - 16) - 8;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  render() {
    return html`<canvas aria-label="Fitness over generations"></canvas>`;
  }
}

customElements.define("qv-fitness-chart", QvFitnessChart);
