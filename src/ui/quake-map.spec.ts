import { describe, expect, it, vi } from "vitest";
import { haversineKm } from "../data/types.js";
import { CANDIDATE_COLORS, HEADLINE_STYLE, eventDotStyle, geodesicCircle, starPoints, type QvQuakeMap } from "./quake-map.js";

describe("geodesicCircle", () => {
  it("puts every ring point at the requested great-circle distance", () => {
    const ring = geodesicCircle(-21.3, 168.6, 800);
    expect(ring).toHaveLength(73);
    for (const [lat, lon] of ring) {
      expect(haversineKm(-21.3, 168.6, lat, lon)).toBeCloseTo(800, 0);
    }
  });

  it("keeps longitudes continuous across the antimeridian", () => {
    const ring = geodesicCircle(-15, 179.5, 1000);
    for (let i = 1; i < ring.length; i++) {
      expect(Math.abs(ring[i][1] - ring[i - 1][1])).toBeLessThan(10);
    }
    expect(Math.max(...ring.map((p) => p[1]))).toBeGreaterThan(180);
  });

  it("has three distinct candidate colours", () => {
    expect(new Set(CANDIDATE_COLORS).size).toBe(3);
  });
});

describe("eventDotStyle", () => {
  it("draws bigger, more opaque dots for bigger events and keeps M4.5 visible", () => {
    const small = eventDotStyle(4.5);
    const big = eventDotStyle(7);
    expect(small.r).toBeGreaterThan(0);
    expect(small.alpha).toBeGreaterThan(0.1);
    expect(big.r).toBeGreaterThan(small.r);
    expect(big.alpha).toBeGreaterThan(small.alpha);
    expect(eventDotStyle(9.5).alpha).toBeLessThanOrEqual(0.8);
  });
});

describe("headline marker", () => {
  it("starPoints alternates outer / inner radius, first point straight up", () => {
    const pts = starPoints(10, 20, 8);
    expect(pts).toHaveLength(10);
    expect(pts[0][0]).toBeCloseTo(10, 10);
    expect(pts[0][1]).toBeCloseTo(12, 10);
    pts.forEach(([x, y], i) => expect(Math.hypot(x - 10, y - 20)).toBeCloseTo(i % 2 ? 8 * 0.45 : 8, 10));
  });

  it("uses a style distinct from the candidate colours and the yellow walk-forward markers", () => {
    expect(CANDIDATE_COLORS).not.toContain(HEADLINE_STYLE.star);
    expect(HEADLINE_STYLE.star.toLowerCase()).not.toBe("#f0b429");
    expect(HEADLINE_STYLE.ringDash.length).toBeGreaterThan(0);
  });

  it("renders a positioned overlay for the headline and highlights it on focus", async () => {
    // jsdom has no 2D canvas; the drawing path bails out cleanly on a null context.
    const spy = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const el = document.createElement("qv-quake-map") as QvQuakeMap;
    document.body.appendChild(el);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-testid=headline-marker]")).toBeNull();
    el.headline = {
      lat: -29.7,
      lon: 190,
      mag: 5.45,
      time: 0,
      radiusKm: 300,
      label: "M5.45 headline",
      version: 1,
      stale: false
    };
    await el.updateComplete;
    const m = el.shadowRoot!.querySelector<HTMLElement>("[data-testid=headline-marker]")!;
    expect(m.dataset.lat).toBe("-29.700");
    expect(m.dataset.mag).toBe("5.45");
    expect(m.classList.contains("pulse")).toBe(true);
    // lon 190 → -170 → left = 10/360
    expect(m.style.left).toBe(`${((10 / 360) * 100).toFixed(3)}%`);
    el.focusHeadline();
    await new Promise((r) => setTimeout(r, 50));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-testid=headline-marker]")!.classList.contains("focus")).toBe(true);
    el.remove();
    spy.mockRestore();
  });
});
