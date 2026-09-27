import { describe, expect, it } from "vitest";
import {
  COMPACT_FIELDS,
  COMPACT_FORMAT,
  DEFAULTS,
  parseArgs,
  regionFromPlace,
  toCompactDataset,
  toDataset,
  toEvents,
  yearWindows
} from "./update-earthquakes.mjs";

const feature = (id, time, lon, lat, mag, place = "x", depth = 10) => ({
  id,
  properties: { time, mag, place },
  geometry: { coordinates: [lon, lat, depth] }
});

describe("update-earthquakes toEvents", () => {
  it("rounds, strips place prefixes, sorts and dedupes across pages", () => {
    const events = toEvents([
      { features: [feature("b", 2_000_400, 168.6123, -21.29824, 6.6, "80 km ENE of Tadine, New Caledonia", 33.4)] },
      {
        features: [
          feature("a", 1_000_000, -171.50334, 52.95641, 6.456),
          feature("a", 1_000_000, -171.5, 52.9, 6.4),
          feature("bad", 1500, 0, 0, null),
          { id: "nogeo", properties: { time: 1, mag: 6 } }
        ]
      }
    ]);
    expect(events).toEqual([
      { id: "a", time: 1_000_000, lat: 52.96, lon: -171.5, depth: 10, mag: 6.46, place: "x" },
      { id: "b", time: 2_000_000, lat: -21.3, lon: 168.61, depth: 33, mag: 6.6, place: "Tadine, New Caledonia" }
    ]);
  });

  it("rejects unexpected payloads", () => {
    expect(() => toEvents([{}])).toThrow(/features/);
    expect(() => toDataset({}, "q")).toThrow(/features/);
  });
});

describe("update-earthquakes toCompactDataset", () => {
  it("delta-encodes times and dictionary-encodes places", () => {
    const ds = toCompactDataset(
      [
        { id: "a", time: 1_000_000, lat: 1, lon: 2, depth: 10, mag: 4.5, place: "Tonga" },
        { id: "b", time: 1_060_000, lat: 3, lon: 4, depth: 20, mag: 5.5, place: "" },
        { id: "c", time: 1_061_000, lat: 5, lon: 6, depth: 30, mag: 6.5, place: "Tonga" }
      ],
      { query: "q", minMag: 4.5 }
    );
    expect(ds).toEqual({
      source: "USGS FDSN event API",
      query: "q",
      minMag: 4.5,
      count: 3,
      format: COMPACT_FORMAT,
      fields: COMPACT_FIELDS,
      t0: 1_000_000,
      places: ["Tonga"],
      events: [
        [0, 1, 2, 10, 4.5, 0],
        [60, 3, 4, 20, 5.5, -1],
        [1, 5, 6, 30, 6.5, 0]
      ]
    });
    expect(toCompactDataset([], { query: "q", minMag: 5 }).t0).toBe(0);
  });
});

describe("update-earthquakes helpers", () => {
  it("regionFromPlace matches the app's prefix stripping", () => {
    expect(regionFromPlace("63 km W of Coquimbo, Chile")).toBe("Coquimbo, Chile");
    expect(regionFromPlace("south of the Fiji Islands")).toBe("south of the Fiji Islands");
  });

  it("yearWindows pages the range by calendar year", () => {
    const w = yearWindows(new Date("2018-01-01T00:00:00Z"), new Date("2020-03-01T00:00:00Z"));
    expect(w.map(([a, b]) => [a.toISOString().slice(0, 10), b.toISOString().slice(0, 10)])).toEqual([
      ["2018-01-01", "2019-01-01"],
      ["2019-01-01", "2020-01-01"],
      ["2020-01-01", "2020-03-01"]
    ]);
  });

  it("parseArgs defaults to the M4.5 floor and an end of now", () => {
    const o = parseArgs([]);
    expect(o.start).toBe(DEFAULTS.start);
    expect(o.minmag).toBe("4.5");
    expect(o.end).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(parseArgs(["--end", "2026-09-27"]).end).toBe("2026-09-27");
    expect(() => parseArgs(["--nope", "1"])).toThrow(/Unknown/);
  });
});
