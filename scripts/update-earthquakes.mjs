#!/usr/bin/env node
/**
 * Refresh the bundled catalog snapshot from the USGS FDSN event web service.
 *
 *   npm run data:update                                  # 2018-01-01 → now, M≥4.5
 *   npm run data:update -- --end 2026-09-27T10:59:00     # fixed end
 *   npm run data:update -- --minmag 5.0                  # higher floor (smaller file)
 *
 * The USGS service caps a single query at 20,000 events, so the window is paged by calendar
 * year and any page that hits the cap is split in half until it fits.
 *
 * Output format (public/data/earthquakes.json) — compact, Pages-friendly JSON (~3 MB at M≥4.5):
 *   {
 *     source, query, minMag, count,
 *     format: "qv-compact-1",
 *     fields: ["dt", "lat", "lon", "depth", "mag", "place"],
 *     t0,                // epoch ms of the first event (whole seconds)
 *     places: [...],     // de-duplicated region names ("63 km W of Coquimbo, Chile" → "Coquimbo, Chile")
 *     events: [[dt, lat, lon, depth, mag, placeIndex], ...]   // sorted by time
 *   }
 * dt = whole seconds since the previous event (first row: since t0). lat/lon rounded to 0.01°,
 * depth to 1 km, mag to 0.01. placeIndex is -1 when USGS gives no place.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const USGS_QUERY_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query";
export const USGS_LIMIT = 20000;
export const COMPACT_FORMAT = "qv-compact-1";
export const COMPACT_FIELDS = ["dt", "lat", "lon", "depth", "mag", "place"];
export const DEFAULTS = {
  start: "2018-01-01",
  minmag: "4.5",
  out: "public/data/earthquakes.json"
};

const round = (v, dp) => Math.round(v * 10 ** dp) / 10 ** dp;

/** Same rule as src/data/places.ts regionFromPlace: drop the "63 km W of " prefix. */
export function regionFromPlace(place) {
  return String(place).replace(/^\s*\d+(\.\d+)?\s*km\s+[NSEW]{1,3}\s+of\s+/i, "").trim();
}

/** Flatten USGS GeoJSON FeatureCollections into sorted, de-duplicated plain events. */
export function toEvents(collections) {
  const seen = new Set();
  const events = [];
  for (const geojson of collections) {
    if (!geojson || !Array.isArray(geojson.features)) {
      throw new Error("Unexpected USGS response: missing features array");
    }
    for (const f of geojson.features) {
      const p = f?.properties ?? {};
      const c = f?.geometry?.coordinates;
      if (!f?.id || seen.has(f.id) || !Array.isArray(c)) continue;
      const [lon, lat, depth] = c;
      if (![p.time, p.mag, lat, lon].every((v) => typeof v === "number" && Number.isFinite(v))) continue;
      seen.add(f.id);
      events.push({
        id: String(f.id),
        time: Math.round(p.time / 1000) * 1000,
        lat: round(lat, 2),
        lon: round(lon, 2),
        depth: typeof depth === "number" && Number.isFinite(depth) ? Math.round(depth) : 0,
        mag: round(p.mag, 2),
        place: typeof p.place === "string" ? regionFromPlace(p.place) : ""
      });
    }
  }
  events.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  return events;
}

/** Encode plain events into the compact bundled format described above. */
export function toCompactDataset(events, { query, minMag }) {
  const places = [];
  const placeIndex = new Map();
  const t0 = events.length ? events[0].time : 0;
  let prev = t0;
  const rows = events.map((ev) => {
    let pi = -1;
    if (ev.place) {
      if (!placeIndex.has(ev.place)) {
        placeIndex.set(ev.place, places.length);
        places.push(ev.place);
      }
      pi = placeIndex.get(ev.place);
    }
    const dt = Math.round((ev.time - prev) / 1000);
    prev = ev.time;
    return [dt, ev.lat, ev.lon, ev.depth, ev.mag, pi];
  });
  return {
    source: "USGS FDSN event API",
    query,
    minMag,
    count: rows.length,
    format: COMPACT_FORMAT,
    fields: COMPACT_FIELDS,
    t0,
    places,
    events: rows
  };
}

/** Back-compat helper: one GeoJSON response → compact dataset. */
export function toDataset(geojson, query, minMag = Number(DEFAULTS.minmag)) {
  return toCompactDataset(toEvents([geojson]), { query, minMag });
}

/** Calendar-year windows [start, end) covering start → end. */
export function yearWindows(start, end) {
  const out = [];
  let cur = new Date(start);
  const stop = new Date(end);
  while (cur < stop) {
    const next = new Date(Date.UTC(cur.getUTCFullYear() + 1, 0, 1));
    out.push([cur, next < stop ? next : stop]);
    cur = next;
  }
  return out;
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

const iso = (d) => d.toISOString().slice(0, 19);

async function fetchWindow(from, to, minmag, depth = 0) {
  const params = new URLSearchParams({
    format: "geojson",
    starttime: iso(from),
    endtime: iso(to),
    minmagnitude: minmag,
    orderby: "time-asc",
    limit: String(USGS_LIMIT)
  });
  const url = `${USGS_QUERY_URL}?${params}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`USGS HTTP ${res.status}`);
      const json = await res.json();
      if (json.features.length >= USGS_LIMIT) {
        if (depth > 8) throw new Error("Could not page below the USGS 20000-event limit");
        const mid = new Date((from.getTime() + to.getTime()) / 2);
        return [...(await fetchWindow(from, mid, minmag, depth + 1)), ...(await fetchWindow(mid, to, minmag, depth + 1))];
      }
      console.log(`  ${iso(from)} → ${iso(to)}: ${json.features.length} events`);
      return [json];
    } catch (err) {
      if (attempt >= 4) throw err;
      console.warn(`  retry ${attempt} for ${iso(from)}: ${err instanceof Error ? err.message : err}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const endDate = new Date(opts.end.endsWith("Z") ? opts.end : `${opts.end}Z`);
  const startDate = new Date(opts.start.endsWith("Z") ? opts.start : `${opts.start}Z`);
  console.log(`Fetching USGS M≥${opts.minmag} ${opts.start} → ${opts.end} (paged by year)`);
  const pages = [];
  for (const [from, to] of yearWindows(startDate, endDate)) {
    pages.push(...(await fetchWindow(from, to, opts.minmag)));
  }
  const query = `minmagnitude=${opts.minmag} starttime=${opts.start} endtime=${opts.end}`;
  const ds = toCompactDataset(toEvents(pages), { query, minMag: Number(opts.minmag) });
  const json = JSON.stringify(ds);
  writeFileSync(opts.out, json);
  const lastTime = ds.t0 + ds.events.reduce((s, r) => s + r[0], 0) * 1000;
  console.log(
    `Wrote ${ds.count} events (${ds.places.length} places, ${(json.length / 1e6).toFixed(2)} MB) to ${opts.out}; ` +
      `latest ${ds.count ? new Date(lastTime).toISOString() : "n/a"}`
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
