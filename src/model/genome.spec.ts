import { describe, expect, it } from "vitest";
import {
  GENOME_LENGTH,
  HEAD_COUNT,
  LEGACY_GENOME_LENGTH,
  WEIGHTS_PER_HEAD,
  WEIGHT_MAX,
  WEIGHT_MIN,
  clampGenome,
  createGoodPriorGenome,
  createRandomGenome,
  genomeFromGenes,
  predict
} from "./genome.js";
import { FEATURE_DIM } from "../features/extract.js";

describe("genome", () => {
  it("creates genomes of fixed length", () => {
    const g = createRandomGenome(() => 0.42);
    expect(g.genes.length).toBe(GENOME_LENGTH);
  });

  it("has only regression weights — no evolved tolerance genes", () => {
    expect(GENOME_LENGTH).toBe(HEAD_COUNT * WEIGHTS_PER_HEAD);
    expect(LEGACY_GENOME_LENGTH).toBe(GENOME_LENGTH + 3);
  });

  it("clamps weights", () => {
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

  it("genomeFromGenes accepts current and legacy (tolerance-gene) shapes", () => {
    const g = createRandomGenome(() => 0.3);
    const same = genomeFromGenes(g.genes);
    expect(Array.from(same.genes)).toEqual(Array.from(g.genes));
    expect(same.genes).not.toBe(g.genes);

    const legacy = [...Array.from(g.genes), 0.5, 5, 0.5]; // old trailing time/dist/mag tolerance genes
    const upgraded = genomeFromGenes(legacy);
    expect(upgraded.genes.length).toBe(GENOME_LENGTH);
    expect(Array.from(upgraded.genes)).toEqual(Array.from(g.genes));

    const wild = genomeFromGenes(new Array(GENOME_LENGTH).fill(99));
    expect(Math.max(...wild.genes)).toBe(WEIGHT_MAX);
  });

  it("genomeFromGenes rejects other shapes and non-finite genes", () => {
    expect(() => genomeFromGenes([1, 2, 3])).toThrow();
    const bad = new Array(GENOME_LENGTH).fill(0);
    bad[3] = Number.NaN;
    expect(() => genomeFromGenes(bad)).toThrow();
  });
});
