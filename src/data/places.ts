import { haversineKm, type QuakeEvent } from "./types.js";

export interface NearestPlace {
  /** Readable region name derived from the nearest catalog event's USGS `place` string. */
  name: string;
  /** Great-circle distance (km) to that catalog event. */
  distanceKm: number;
}

/**
 * Strip the USGS "63 km W of " prefix so "63 km W of Coquimbo, Chile" → "Coquimbo, Chile".
 * Strings without the prefix (e.g. "south of the Fiji Islands") are returned trimmed.
 */
export function regionFromPlace(place: string): string {
  return place.replace(/^\s*\d+(\.\d+)?\s*km\s+[NSEW]{1,3}\s+of\s+/i, "").trim();
}

/**
 * Cheap offline reverse-geocode: nearest catalog event that has a `place` label.
 * Returns null when no event carries a place string.
 */
export function nearestPlace(events: QuakeEvent[], lat: number, lon: number): NearestPlace | null {
  let best: NearestPlace | null = null;
  for (const ev of events) {
    if (!ev.place) continue;
    const d = haversineKm(lat, lon, ev.lat, ev.lon);
    if (!best || d < best.distanceKm) {
      best = { name: regionFromPlace(ev.place), distanceKm: d };
    }
  }
  return best;
}

/** Human-readable label, e.g. "near Coquimbo, Chile" or "~950 km from Tonga". */
export function describeLocation(events: QuakeEvent[], lat: number, lon: number): string {
  const near = nearestPlace(events, lat, lon);
  if (!near || !near.name) return "no nearby catalog region";
  if (near.distanceKm <= 300) return `near ${near.name}`;
  return `~${Math.round(near.distanceKm / 50) * 50} km from ${near.name}`;
}
