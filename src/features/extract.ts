import { cellKey, MS_PER_DAY, MS_PER_HOUR, type QuakeEvent } from "../data/types.js";

/** Number of history features fed to the genome. */
export const FEATURE_DIM = 11;

export const FEATURE_NAMES = [
  "mag",
  "logHoursSincePrev",
  "meanMag5",
  "meanMag20",
  "count7d",
  "count30d",
  "count7dInCell",
  "logHoursSinceCell",
  "latNorm",
  "lonNorm",
  "magAnomaly20"
] as const;

const MIN_HISTORY = 20;

export function minHistoryIndex(): number {
  return MIN_HISTORY;
}

function meanMag(events: QuakeEvent[], endInclusive: number, k: number): number {
  const start = Math.max(0, endInclusive - k + 1);
  let sum = 0;
  let n = 0;
  for (let i = start; i <= endInclusive; i++) {
    sum += events[i].mag;
    n++;
  }
  return n === 0 ? 0 : sum / n;
}

function countSince(events: QuakeEvent[], endInclusive: number, windowMs: number, cell?: string): number {
  const tEnd = events[endInclusive].time;
  const tStart = tEnd - windowMs;
  let n = 0;
  for (let i = endInclusive; i >= 0; i--) {
    if (events[i].time < tStart) break;
    if (cell !== undefined && cellKey(events[i].lat, events[i].lon) !== cell) continue;
    n++;
  }
  return n;
}

function hoursSinceLastInCell(events: QuakeEvent[], endInclusive: number): number {
  const cell = cellKey(events[endInclusive].lat, events[endInclusive].lon);
  for (let i = endInclusive - 1; i >= 0; i--) {
    if (cellKey(events[i].lat, events[i].lon) === cell) {
      return (events[endInclusive].time - events[i].time) / MS_PER_HOUR;
    }
  }
  return 365 * 24; // one year proxy if never seen
}

/**
 * Extract a deterministic feature vector from history events[0..i] (inclusive).
 * Used to predict properties of event i+1.
 */
export function extractFeatures(events: QuakeEvent[], i: number): Float64Array {
  if (i < 0 || i >= events.length) {
    throw new Error(`Feature index out of range: ${i}`);
  }
  const cur = events[i];
  const hoursSincePrev =
    i > 0 ? (cur.time - events[i - 1].time) / MS_PER_HOUR : 24 * 30;
  const m5 = meanMag(events, i, 5);
  const m20 = meanMag(events, i, 20);
  const cell = cellKey(cur.lat, cur.lon);
  const out = new Float64Array(FEATURE_DIM);
  out[0] = cur.mag;
  out[1] = Math.log1p(Math.max(0, hoursSincePrev));
  out[2] = m5;
  out[3] = m20;
  out[4] = countSince(events, i, 7 * MS_PER_DAY);
  out[5] = countSince(events, i, 30 * MS_PER_DAY);
  out[6] = countSince(events, i, 7 * MS_PER_DAY, cell);
  out[7] = Math.log1p(Math.max(0, hoursSinceLastInCell(events, i)));
  out[8] = cur.lat / 90;
  out[9] = cur.lon / 180;
  out[10] = cur.mag - m20;
  return out;
}

export interface TargetTriple {
  /** log1p(hours until next). */
  logHours: number;
  lat: number;
  lon: number;
  mag: number;
}

export function extractTarget(events: QuakeEvent[], i: number): TargetTriple {
  if (i < 0 || i + 1 >= events.length) {
    throw new Error(`Target index out of range: ${i}`);
  }
  const cur = events[i];
  const next = events[i + 1];
  const hours = Math.max(0, (next.time - cur.time) / MS_PER_HOUR);
  return {
    logHours: Math.log1p(hours),
    lat: next.lat,
    lon: next.lon,
    mag: next.mag
  };
}

/** Display bins for UI / soft credit. */
export const TIME_BIN_LABELS = ["≤12h", "12–48h", "2–7d", "7–30d", "30–90d", ">90d"] as const;
export const MAG_BIN_LABELS = ["<5.5", "5.5–6.0", "6.0–6.5", "6.5–7.0", "7.0–7.5", "≥7.5"] as const;

export function timeBinFromHours(hours: number): number {
  if (hours <= 12) return 0;
  if (hours <= 48) return 1;
  if (hours <= 24 * 7) return 2;
  if (hours <= 24 * 30) return 3;
  if (hours <= 24 * 90) return 4;
  return 5;
}

export function magBin(mag: number): number {
  if (mag < 5.5) return 0;
  if (mag < 6.0) return 1;
  if (mag < 6.5) return 2;
  if (mag < 7.0) return 3;
  if (mag < 7.5) return 4;
  return 5;
}

export function hoursFromLog(logHours: number): number {
  return Math.expm1(logHours);
}
