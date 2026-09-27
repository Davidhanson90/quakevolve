import { describe, expect, it } from "vitest";
import type { QuakeEvent } from "./types.js";
import { describeLocation, nearestPlace, regionFromPlace } from "./places.js";

const events: QuakeEvent[] = [
  { id: "a", time: 1, lat: -29.9, lon: -72.0, mag: 5.5, place: "63 km W of Coquimbo, Chile" },
  { id: "b", time: 2, lat: -24.8, lon: 178.4, mag: 5.9, place: "south of the Fiji Islands" },
  { id: "c", time: 3, lat: 0, lon: 0, mag: 5.6 }
];

describe("regionFromPlace", () => {
  it("strips the USGS distance/bearing prefix", () => {
    expect(regionFromPlace("63 km W of Coquimbo, Chile")).toBe("Coquimbo, Chile");
    expect(regionFromPlace("2.5 km SSE of Town, Japan")).toBe("Town, Japan");
    expect(regionFromPlace("  south of the Fiji Islands ")).toBe("south of the Fiji Islands");
  });
});

describe("nearestPlace", () => {
  it("finds the closest labelled event and ignores unlabelled ones", () => {
    const n = nearestPlace(events, -30, -71.5);
    expect(n?.name).toBe("Coquimbo, Chile");
    expect(n!.distanceKm).toBeLessThan(100);
    // (0,0) has no place → falls back to a labelled event
    expect(nearestPlace(events, 0, 0)?.name).toBeDefined();
  });

  it("returns null without labelled events", () => {
    expect(nearestPlace([events[2]], 0, 0)).toBeNull();
    expect(nearestPlace([], 0, 0)).toBeNull();
  });
});

describe("describeLocation", () => {
  it("says near/from depending on distance", () => {
    expect(describeLocation(events, -29.5, -71.8)).toBe("near Coquimbo, Chile");
    expect(describeLocation(events, -20, 170)).toMatch(/^~\d+ km from south of the Fiji Islands$/);
    expect(describeLocation([], 0, 0)).toBe("no nearby catalog region");
  });
});
