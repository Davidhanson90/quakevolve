import { describe, expect, it } from "vitest";
import type { BannerSnapshot } from "../model/banner.js";
import type { BiggestForecastResult } from "../model/forecast.js";
import { SCORE_TOLERANCES } from "../model/scoring-config.js";
import {
  googleMapsUrl,
  headlineFromSnapshot,
  headlineLabel,
  mapPercent,
  normalizeLon,
  wrapOffsets
} from "./headline.js";

describe("normalizeLon", () => {
  it("wraps any longitude into [-180, 180)", () => {
    expect(normalizeLon(0)).toBe(0);
    expect(normalizeLon(179.9)).toBeCloseTo(179.9, 10);
    expect(normalizeLon(-179.9)).toBeCloseTo(-179.9, 10);
    expect(normalizeLon(181)).toBeCloseTo(-179, 10);
    expect(normalizeLon(-181)).toBeCloseTo(179, 10);
    expect(normalizeLon(540)).toBeCloseTo(-180, 10);
    expect(normalizeLon(180)).toBe(-180);
    expect(normalizeLon(725.5)).toBeCloseTo(5.5, 10);
  });
});

describe("googleMapsUrl", () => {
  const base = "https://www.google.com/maps/search/?api=1&query=";

  it("builds a search URL with 3-decimal coordinates", () => {
    expect(googleMapsUrl(-29.71234, 153.84567)).toBe(`${base}-29.712,153.846`);
    expect(googleMapsUrl(47.3, 161.7)).toBe(`${base}47.300,161.700`);
  });

  it("normalises longitude across the antimeridian", () => {
    expect(googleMapsUrl(-15, 190.25)).toBe(`${base}-15.000,-169.750`);
    expect(googleMapsUrl(-15, -190.25)).toBe(`${base}-15.000,169.750`);
    expect(googleMapsUrl(10, 360)).toBe(`${base}10.000,0.000`);
  });

  it("clamps latitude and never emits negative zero", () => {
    expect(googleMapsUrl(95, 0)).toBe(`${base}90.000,0.000`);
    expect(googleMapsUrl(-0.0001, -0.0002)).toBe(`${base}0.000,0.000`);
  });
});

describe("headlineFromSnapshot", () => {
  const forecast = (pred: BiggestForecastResult["prediction"]): BiggestForecastResult => ({
    anchorTime: 0,
    lastEventTime: 0,
    prediction: pred,
    chainMags: pred ? [pred.mag] : [],
    stepsRun: 1,
    maxSteps: 30,
    stoppedReason: pred ? "complete" : "degenerate"
  });
  const snap = (pred: BiggestForecastResult["prediction"]): BannerSnapshot => ({
    forecast: forecast(pred),
    key: "abc123",
    fitness: 0.3,
    foundGeneration: 2,
    generation: 5,
    catalogMinMag: 5.5,
    computedAt: 0,
    version: 7
  });
  const pred: NonNullable<BiggestForecastResult["prediction"]> = {
    step: 3,
    time: Date.UTC(2026, 9, 1),
    windowStart: 0,
    windowEnd: 0,
    lat: -20.5,
    lon: 185.5,
    mag: 5.4499,
    radiusKm: 300,
    region: "near Tonga"
  };

  it("maps the banner prediction to a map marker (same lat/lon/mag, normalised lon)", () => {
    const hl = headlineFromSnapshot(snap(pred))!;
    expect(hl.lat).toBe(-20.5);
    expect(hl.lon).toBeCloseTo(-174.5, 10);
    expect(hl.mag).toBe(5.4499);
    expect(hl.label).toBe("M5.45 headline");
    expect(hl.radiusKm).toBe(SCORE_TOLERANCES.distKm);
    expect(hl.version).toBe(7);
    expect(hl.stale).toBe(false);
    expect(headlineFromSnapshot(snap(pred), true)!.stale).toBe(true);
  });

  it("is null without a snapshot or prediction", () => {
    expect(headlineFromSnapshot(null)).toBeNull();
    expect(headlineFromSnapshot(snap(null))).toBeNull();
  });

  it("labels with two decimals", () => {
    expect(headlineLabel(7)).toBe("M7.00 headline");
  });
});

describe("wrapOffsets / mapPercent", () => {
  it("adds a copy on the opposite edge only when the shape crosses an edge", () => {
    expect(wrapOffsets(500, 20, 1000)).toEqual([0]);
    expect(wrapOffsets(10, 20, 1000)).toEqual([0, 1000]);
    expect(wrapOffsets(995, 20, 1000)).toEqual([0, -1000]);
  });

  it("positions points as percentages of an equirectangular map", () => {
    expect(mapPercent(0, 0)).toEqual({ left: 50, top: 50 });
    expect(mapPercent(90, -180)).toEqual({ left: 0, top: 0 });
    expect(mapPercent(-90, 90)).toEqual({ left: 75, top: 100 });
    expect(mapPercent(0, 190).left).toBeCloseTo(((-170 + 180) / 360) * 100, 10);
  });
});
