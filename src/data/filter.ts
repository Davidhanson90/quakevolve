import type { QuakeEvent } from "./types.js";

/** Minimum-magnitude slider: step, default (the original M≥5.5 catalog) and upper end. */
export const MIN_MAG_STEP = 0.1;
export const DEFAULT_MIN_MAG = 5.5;
export const MAX_MIN_MAG = 7.5;

/** Tolerance so 5.5 stored as 5.5 still passes a slider value like 5.499999999. */
const EPS = 1e-6;

/** Snap a (possibly float-noisy) slider value to the 0.1 grid. */
export function roundMag(m: number): number {
  return Math.round(m / MIN_MAG_STEP) / 10;
}

/** Events with magnitude ≥ minMag, order preserved (time-sorted in → time-sorted out). */
export function filterByMinMag(events: QuakeEvent[], minMag: number): QuakeEvent[] {
  const m = roundMag(minMag) - EPS;
  return events.filter((ev) => ev.mag >= m);
}

/** Count of events with magnitude ≥ minMag (no allocation). */
export function countAtOrAbove(events: QuakeEvent[], minMag: number): number {
  const m = roundMag(minMag) - EPS;
  let n = 0;
  for (const ev of events) if (ev.mag >= m) n++;
  return n;
}

export interface MinMagRange {
  min: number;
  max: number;
  step: number;
  default: number;
}

/**
 * Slider range for a catalog whose floor is `floor`: from the floor (rounded up to 0.1)
 * to MAX_MIN_MAG. The default stays M5.5 when the data goes that low, so the original
 * behaviour is unchanged.
 */
export function minMagRange(floor: number): MinMagRange {
  const min = Math.min(MAX_MIN_MAG, Math.ceil(floor / MIN_MAG_STEP - EPS) / 10);
  return {
    min,
    max: MAX_MIN_MAG,
    step: MIN_MAG_STEP,
    default: clampMinMag(DEFAULT_MIN_MAG, min)
  };
}

export function clampMinMag(m: number, min: number, max = MAX_MIN_MAG): number {
  return roundMag(Math.min(max, Math.max(min, m)));
}

/**
 * Indices of the events in the last `days` of the catalog (relative to its final event),
 * but at least the last `minCount` events and never before `fromIndex`. Used to pick which
 * walk-forward predictions to show: lower threshold → denser catalog → more of them.
 */
export function recentIndices(events: QuakeEvent[], days: number, minCount: number, fromIndex = 0): number[] {
  const n = events.length;
  if (n === 0) return [];
  const cutoff = events[n - 1].time - days * 86_400_000;
  let start = n - 1;
  while (start > fromIndex && events[start - 1].time >= cutoff) start--;
  start = Math.max(fromIndex, Math.min(start, n - minCount));
  const out: number[] = [];
  for (let i = start; i < n; i++) out.push(i);
  return out;
}
