import { describe, expect, it } from "vitest";
import { DEFAULTS, parseArgs, toDataset } from "./update-earthquakes.mjs";

const feature = (id, time, lon, lat, mag, place = "x") => ({
  id,
  properties: { time, mag, place },
  geometry: { coordinates: [lon, lat, 10] }
});

describe("update-earthquakes toDataset", () => {
  it("keeps the bundled format, rounds, sorts and dedupes", () => {
    const ds = toDataset(
      {
        features: [
          feature("b", 2000, 168.6123, -21.29824, 6.6, "80 km ENE of Tadine, New Caledonia"),
          feature("a", 1000, -171.50334, 52.95641, 6.456),
          feature("a", 1000, -171.5, 52.9, 6.4),
          feature("bad", 1500, 0, 0, null),
          { id: "nogeo", properties: { time: 1, mag: 6 } }
        ]
      },
      "q"
    );
    expect(ds).toEqual({
      source: "USGS FDSN event API",
      query: "q",
      count: 2,
      events: [
        { id: "a", time: 1000, lat: 52.956, lon: -171.503, mag: 6.46, place: "x" },
        { id: "b", time: 2000, lat: -21.298, lon: 168.612, mag: 6.6, place: "80 km ENE of Tadine, New Caledonia" }
      ]
    });
  });

  it("rejects unexpected payloads", () => {
    expect(() => toDataset({}, "q")).toThrow(/features/);
  });
});

describe("update-earthquakes parseArgs", () => {
  it("defaults to the existing query and an end of now", () => {
    const o = parseArgs([]);
    expect(o.start).toBe(DEFAULTS.start);
    expect(o.minmag).toBe("5.5");
    expect(o.end).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(parseArgs(["--end", "2026-09-27"]).end).toBe("2026-09-27");
    expect(() => parseArgs(["--nope", "1"])).toThrow(/Unknown/);
  });
});
