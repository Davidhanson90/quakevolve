import { describe, expect, it } from "vitest";
import {
  GENOME_LENGTH,
  WEIGHT_MAX,
  WEIGHT_MIN,
  clampGenome,
  createGoodPriorGenome,
  createRandomGenome,
  predict
} from "./genome.js";
import { FEATURE_DIM } from "../features/extract.js";

describe("genome", () => {
  it("creates genomes of fixed length", () => {
    const g = createRandomGenome(() => 0.42);
    expect(g.genes.length).toBe(GENOME_LENGTH);
  });

  it("clamps weights and tolerances", () => {
    const g = createRandomGenome(() => 0.5);
    g.genes[0] = 99;
    g.genes[GENOME_LENGTH - 1] = -5;
    clampGenome(g);
    expect(g.genes[0]).toBeLessThanOrEqual(WEIGHT_MAX);
    expect(g.genes[0]).toBeGreaterThanOrEqual(WEIGHT_MIN);
  });

  it("predict returns finite values in range", () => {
    const g = createGoodPriorGenome();
    const feats = new Float64Array(FEATURE_DIM);
    feats[0] = 6;
    feats[8] = 0.1;
    feats[9] = 0.5;
    const p = predict(g, feats, 10, 20);
    expect(Number.isFinite(p.logHours)).toBe(true);
    expect(p.lat).toBeGreaterThanOrEqual(-90);
    expect(p.lat).toBeLessThanOrEqual(90);
    expect(p.mag).toBeGreaterThanOrEqual(4.5);
  });
});
