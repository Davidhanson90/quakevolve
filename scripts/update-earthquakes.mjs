#!/usr/bin/env node
/**
 * Refresh the bundled catalog snapshot from the USGS FDSN event web service.
 *
 *   npm run data:update                       # 2018-01-01 → now, M≥5.5
 *   npm run data:update -- --end 2026-09-27   # fixed end date
 *
 * Output format (public/data/earthquakes.json) — compact JSON, events sorted by time:
 *   { source, query, count, events: [{ id, time, lat, lon, mag, place }] }
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const USGS_QUERY_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query";
export const DEFAULTS = {
  start: "2018-01-01",
  minmag: "5.5",
  out: "public/data/earthquakes.json"
};

const round = (v, dp) => Math.round(v * 10 ** dp) / 10 ** dp;

/** Convert a USGS GeoJSON FeatureCollection into the bundled dataset shape. */
export function toDataset(geojson, query) {
  if (!geojson || !Array.isArray(geojson.features)) {
    throw new Error("Unexpected USGS response: missing features array");
  }
  const seen = new Set();
  const events = [];
  for (const f of geojson.features) {
    const p = f?.properties ?? {};
    const c = f?.geometry?.coordinates;
    if (!f?.id || seen.has(f.id) || !Array.isArray(c)) continue;
    const [lon, lat] = c;
    if (![p.time, p.mag, lat, lon].every((v) => typeof v === "number" && Number.isFinite(v))) continue;
    seen.add(f.id);
    events.push({
      id: String(f.id),
      time: p.time,
      lat: round(lat, 3),
      lon: round(lon, 3),
      mag: round(p.mag, 2),
      place: typeof p.place === "string" ? p.place : ""
    });
  }
  events.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  return { source: "USGS FDSN event API", query, count: events.length, events };
}

export function parseArgs(argv) {
  const opts = { ...DEFAULTS, end: new Date().toISOString().slice(0, 19) };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    if (!(key in opts) || argv[i + 1] === undefined) throw new Error(`Unknown or incomplete option: ${argv[i]}`);
    opts[key] = argv[i + 1];
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const params = new URLSearchParams({
    format: "geojson",
    starttime: opts.start,
    endtime: opts.end,
    minmagnitude: opts.minmag,
    orderby: "time-asc",
    limit: "20000"
  });
  const url = `${USGS_QUERY_URL}?${params}`;
  console.log(`Fetching ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`USGS HTTP ${res.status}`);
  const query = `minmagnitude=${opts.minmag} starttime=${opts.start} endtime=${opts.end}`;
  const ds = toDataset(await res.json(), query);
  if (ds.count >= 20000) throw new Error("Hit the USGS 20000-event limit; narrow the query");
  writeFileSync(opts.out, JSON.stringify(ds));
  const last = ds.events.at(-1);
  console.log(`Wrote ${ds.count} events to ${opts.out}; latest ${last ? new Date(last.time).toISOString() : "n/a"}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
