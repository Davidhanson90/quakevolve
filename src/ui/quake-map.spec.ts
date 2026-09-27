import { describe, expect, it } from "vitest";
import { haversineKm } from "../data/types.js";
import { CANDIDATE_COLORS, geodesicCircle } from "./quake-map.js";

describe("geodesicCircle", () => {
  it("puts every ring point at the requested great-circle distance", () => {
    const ring = geodesicCircle(-21.3, 168.6, 800);
    expect(ring).toHaveLength(73);
    for (const [lat, lon] of ring) {
      expect(haversineKm(-21.3, 168.6, lat, lon)).toBeCloseTo(800, 0);
    }
  });

  it("keeps longitudes continuous across the antimeridian", () => {
    const ring = geodesicCircle(-15, 179.5, 1000);
    for (let i = 1; i < ring.length; i++) {
      expect(Math.abs(ring[i][1] - ring[i - 1][1])).toBeLessThan(10);
    }
    expect(Math.max(...ring.map((p) => p[1]))).toBeGreaterThan(180);
  });

  it("has three distinct candidate colours", () => {
    expect(new Set(CANDIDATE_COLORS).size).toBe(3);
  });
});
