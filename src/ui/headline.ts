import type { BannerSnapshot } from "../model/banner.js";
import { SCORE_TOLERANCES } from "../model/scoring-config.js";

/**
 * Headline prediction = the sticky banner's "next biggest predicted quake". The map and the
 * banner both read it from the same throttled BannerTracker snapshot, so they always agree.
 */
export interface MapHeadline {
  lat: number;
  /** Longitude normalised to [-180, 180). */
  lon: number;
  mag: number;
  /** Predicted time (ms since epoch, UTC). */
  time: number;
  /** Radius of the drawn geodesic circle (km): the fixed scoring distance tolerance. */
  radiusKm: number;
  /** Short map label, e.g. "M5.45 headline". */
  label: string;
  /** Changes whenever the banner's displayed prediction changes. */
  version: number;
  /** Banner is showing the last value while the population rebuilds. */
  stale: boolean;
}

/** Longitude wrapped into [-180, 180) (180 itself maps to -180; NaN stays NaN). */
export function normalizeLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** Google Maps search URL for a point, coordinates rounded to 3 decimals (~100 m). */
export function googleMapsUrl(lat: number, lon: number): string {
  const la = Math.max(-90, Math.min(90, lat)).toFixed(3);
  const lo = normalizeLon(lon).toFixed(3);
  // "-0.000" → "0.000" so the URL never carries a negative zero.
  const clean = (s: string) => (/^-0\.0+$/.test(s) ? s.slice(1) : s);
  return `https://www.google.com/maps/search/?api=1&query=${clean(la)},${clean(lo)}`;
}

export function headlineLabel(mag: number): string {
  return `M${mag.toFixed(2)} headline`;
}

/** Map marker for the banner's current snapshot (null when there is nothing to show). */
export function headlineFromSnapshot(snapshot: BannerSnapshot | null, stale = false): MapHeadline | null {
  const p = snapshot?.forecast.prediction;
  if (!snapshot || !p) return null;
  return {
    lat: p.lat,
    lon: normalizeLon(p.lon),
    mag: p.mag,
    time: p.time,
    radiusKm: SCORE_TOLERANCES.distKm,
    label: headlineLabel(p.mag),
    version: snapshot.version,
    stale
  };
}

/**
 * Horizontal copies needed so a shape of half-width `reach` px centred at `x` on a map of
 * width `w` (equirectangular, wraps at the antimeridian) is drawn on both edges if it crosses one.
 */
export function wrapOffsets(x: number, reach: number, w: number): number[] {
  const out = [0];
  if (x - reach < 0) out.push(w);
  if (x + reach > w) out.push(-w);
  return out;
}

/** Position of a point as CSS percentages of an equirectangular map (for DOM overlays). */
export function mapPercent(lat: number, lon: number): { left: number; top: number } {
  return { left: ((normalizeLon(lon) + 180) / 360) * 100, top: ((90 - Math.max(-90, Math.min(90, lat))) / 180) * 100 };
}

/** Window event the banner fires to ask the page to reveal and highlight the headline marker. */
export const FOCUS_HEADLINE_EVENT = "qv-focus-headline";
