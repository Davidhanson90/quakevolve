/** Simplified earthquake record from the bundled USGS snapshot. */
export interface QuakeEvent {
  id: string;
  /** Epoch milliseconds (UTC). */
  time: number;
  lat: number;
  lon: number;
  mag: number;
  /** Hypocentre depth in km (compact snapshot only). */
  depth?: number;
  place?: string;
}

export interface QuakeDataset {
  source: string;
  query: string;
  /** Catalog magnitude floor (USGS `minmagnitude`), or the smallest magnitude present. */
  minMag: number;
  count: number;
  events: QuakeEvent[];
}

/** Coarse geographic cell (degrees). */
export const CELL_LAT = 30;
export const CELL_LON = 30;

export function cellKey(lat: number, lon: number): string {
  const r = Math.floor((lat + 90) / CELL_LAT);
  const c = Math.floor((lon + 180) / CELL_LON);
  return `${r},${c}`;
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;
