import type { QuakeDataset, QuakeEvent } from "./types.js";

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function parseEvent(raw: unknown): QuakeEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!isFiniteNumber(o.time) || !isFiniteNumber(o.lat) || !isFiniteNumber(o.lon) || !isFiniteNumber(o.mag)) {
    return null;
  }
  if (o.lat < -90 || o.lat > 90 || o.lon < -180 || o.lon > 180) return null;
  if (o.mag < 0 || o.mag > 10) return null;
  return {
    id: typeof o.id === "string" ? o.id : String(o.id ?? ""),
    time: o.time,
    lat: o.lat,
    lon: o.lon,
    mag: o.mag,
    place: typeof o.place === "string" ? o.place : undefined
  };
}

/** Validate and sort events ascending by time. */
export function normalizeDataset(raw: unknown): QuakeDataset {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid earthquake dataset: expected an object");
  }
  const o = raw as Record<string, unknown>;
  const list = Array.isArray(o.events) ? o.events : Array.isArray(raw) ? (raw as unknown[]) : null;
  if (!list) throw new Error("Invalid earthquake dataset: missing events array");

  const events: QuakeEvent[] = [];
  for (const item of list) {
    const ev = parseEvent(item);
    if (ev) events.push(ev);
  }
  events.sort((a, b) => a.time - b.time);

  for (let i = 1; i < events.length; i++) {
    if (events[i].time < events[i - 1].time) {
      throw new Error("Dataset sort invariant violated");
    }
  }

  return {
    source: typeof o.source === "string" ? o.source : "unknown",
    query: typeof o.query === "string" ? o.query : "",
    count: events.length,
    events
  };
}

function baseUrl(): string {
  try {
    // Vite injects import.meta.env.BASE_URL (e.g. "/quakevolve/")
    const env = import.meta.env as { BASE_URL?: string };
    return env.BASE_URL ?? "/";
  } catch {
    return "/";
  }
}

/** Fetch bundled JSON (works offline on GitHub Pages). */
export async function loadEarthquakes(url?: string): Promise<QuakeDataset> {
  const candidates = [url, `${baseUrl()}data/earthquakes.json`].filter(
    (u): u is string => typeof u === "string" && u.length > 0
  );
  let lastErr: unknown;
  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${candidate}`);
      const json: unknown = await res.json();
      return normalizeDataset(json);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export function trainHoldoutSplit(
  events: QuakeEvent[],
  trainRatio = 0.7
): { train: QuakeEvent[]; holdout: QuakeEvent[] } {
  const n = events.length;
  const cut = Math.max(2, Math.min(n - 2, Math.floor(n * trainRatio)));
  return {
    train: events.slice(0, cut),
    holdout: events.slice(cut)
  };
}
