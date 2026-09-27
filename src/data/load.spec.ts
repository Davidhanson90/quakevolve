import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPACT_FORMAT, loadEarthquakes, normalizeDataset, trainHoldoutSplit } from "./load.js";

describe("normalizeDataset", () => {
  it("sorts by time and drops invalid rows", () => {
    const ds = normalizeDataset({
      source: "test",
      query: "q",
      events: [
        { id: "b", time: 2000, lat: 10, lon: 20, mag: 5.5 },
        { id: "bad-lat", time: 1500, lat: 99, lon: 0, mag: 5 },
        { id: "bad-mag", time: 1600, lat: 0, lon: 0, mag: 11 },
        { id: "bad-shape", time: 1700 },
        null,
        { id: 12, time: 1000, lat: -10, lon: -20, mag: 6.1, place: "x" }
      ]
    });
    expect(ds.count).toBe(2);
    expect(ds.events[0].id).toBe("12");
    expect(ds.events[0].time).toBeLessThan(ds.events[1].time);
    expect(ds.source).toBe("test");
  });

  it("accepts a bare events array and defaults meta", () => {
    const ds = normalizeDataset([
      { id: "a", time: 2, lat: 1, lon: 2, mag: 5 },
      { id: "b", time: 1, lat: 1, lon: 2, mag: 5.1 }
    ]);
    expect(ds.source).toBe("unknown");
    expect(ds.query).toBe("");
    expect(ds.events[0].id).toBe("b");
  });

  it("decodes the compact snapshot format", () => {
    const ds = normalizeDataset({
      source: "USGS",
      query: "minmagnitude=4.5",
      minMag: 4.5,
      format: COMPACT_FORMAT,
      fields: ["dt", "lat", "lon", "depth", "mag", "place"],
      t0: 1_514_905_039_000,
      places: ["south of the Fiji Islands", "Coquimbo, Chile"],
      events: [
        [0, -24.82, 178.45, 540, 5.9, 0],
        [703, -30.1, -71.5, 35, 4.6, 1],
        [60, 10, 20, 10, 4.7, -1],
        "junk",
        ["x", 0, 0, 0, 5, 0]
      ]
    });
    expect(ds.count).toBe(3);
    expect(ds.minMag).toBe(4.5);
    expect(ds.events[0]).toMatchObject({ time: 1_514_905_039_000, lat: -24.82, depth: 540, mag: 5.9, place: "south of the Fiji Islands" });
    expect(ds.events[1].time).toBe(1_514_905_039_000 + 703_000);
    expect(ds.events[1].place).toBe("Coquimbo, Chile");
    expect(ds.events[2].time).toBe(1_514_905_039_000 + 763_000);
    expect(ds.events[2].place).toBeUndefined();
  });

  it("derives minMag from the data when the file does not say", () => {
    const ds = normalizeDataset({ events: [{ id: "a", time: 1, lat: 0, lon: 0, mag: 5.7 }, { id: "b", time: 2, lat: 0, lon: 0, mag: 5.2 }] });
    expect(ds.minMag).toBe(5.2);
    expect(normalizeDataset({ events: [] }).minMag).toBe(0);
  });

  it("rejects missing events and non-objects", () => {
    expect(() => normalizeDataset({ source: "x" })).toThrow(/events/);
    expect(() => normalizeDataset(null)).toThrow(/object/);
  });
});

describe("trainHoldoutSplit", () => {
  it("splits chronologically", () => {
    const events = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      time: i * 1000,
      lat: 0,
      lon: 0,
      mag: 5.5
    }));
    const { train, holdout } = trainHoldoutSplit(events, 0.7);
    expect(train.length + holdout.length).toBe(10);
    expect(train.at(-1)!.time).toBeLessThan(holdout[0].time);
  });
});

describe("loadEarthquakes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches and normalizes JSON", async () => {
    const payload = {
      source: "USGS",
      query: "test",
      events: [{ id: "a", time: 1, lat: 0, lon: 0, mag: 5.5 }]
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => payload
      }))
    );
    const ds = await loadEarthquakes("/fake/data.json");
    expect(ds.count).toBe(1);
    expect(ds.source).toBe("USGS");
  });

  it("throws when all candidates fail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 404
      }))
    );
    await expect(loadEarthquakes("/nope.json")).rejects.toThrow(/HTTP 404/);
  });
});
