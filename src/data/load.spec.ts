import { afterEach, describe, expect, it, vi } from "vitest";
import { loadEarthquakes, normalizeDataset, trainHoldoutSplit } from "./load.js";

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
