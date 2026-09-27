import { describe, expect, it } from "vitest";
import { MS_PER_DAY, type QuakeEvent } from "../data/types.js";
import { FEATURE_DIM } from "../features/extract.js";
import { initPopulation, evolveOneGeneration, rngFrom, DEFAULT_GA_CONFIG } from "../ga/evolve.js";
import { GENOME_LENGTH, HEAD_COUNT, WEIGHTS_PER_HEAD, type Genome } from "./genome.js";
import {
  BIG_QUAKE_MAG,
  FORECAST_DISCLAIMER,
  exceedanceScore,
  forecastBigQuakes
} from "./forecast.js";

function catalog(n: number): QuakeEvent[] {
  const out: QuakeEvent[] = [];
  let t = Date.UTC(2024, 0, 1);
  for (let i = 0; i < n; i++) {
    out.push({
      id: `c${i}`,
      time: t,
      lat: -20 + (i % 5),
      lon: 170 + (i % 3),
      mag: 5.5 + (i % 4) * 0.2,
      place: i % 2 === 0 ? `${10 + i} km NE of Testville, Tonga` : undefined
    });
    t += 12 * 3_600_000;
  }
  return out;
}

/** Constant-output genome: bias-only heads (predict() does not clamp genes). */
function biasGenome(b: { logHours: number; dLat: number; dLon: number; mag: number }): Genome {
  const genes = new Float64Array(GENOME_LENGTH);
  const biases = [b.logHours, b.dLat, b.dLon, b.mag];
  for (let h = 0; h < HEAD_COUNT; h++) genes[h * WEIGHTS_PER_HEAD + FEATURE_DIM] = biases[h];
  const base = HEAD_COUNT * WEIGHTS_PER_HEAD;
  genes[base] = 0.5; // timeTol (log-hours)
  genes[base + 1] = 5; // → 500 km
  genes[base + 2] = 0.5; // magTol
  return { genes };
}

describe("exceedanceScore", () => {
  it("is 0.5 at the threshold and monotonic in magnitude", () => {
    expect(exceedanceScore(6, 6, 0.5)).toBeCloseTo(0.5);
    expect(exceedanceScore(6.5, 6, 0.5)).toBeGreaterThan(0.5);
    expect(exceedanceScore(5.5, 6, 0.5)).toBeLessThan(0.5);
    expect(exceedanceScore(7.5, 6, 0.5)).toBeGreaterThan(exceedanceScore(6.5, 6, 0.5));
    expect(exceedanceScore(9, 6, 0)).toBeCloseTo(1);
  });
});

describe("forecastBigQuakes", () => {
  it("returns the next 5 M>6 predictions after the catalog end, sorted by date", () => {
    const events = catalog(40);
    const genome = biasGenome({ logHours: Math.log1p(24), dLat: 0, dLon: 0.5, mag: 6.5 });
    const res = forecastBigQuakes(genome, events);
    const end = events.at(-1)!.time;

    expect(res.anchorTime).toBe(end);
    expect(res.stoppedReason).toBe("found");
    expect(res.forecasts).toHaveLength(5);
    res.forecasts.forEach((f, i) => {
      expect(f.rank).toBe(i + 1);
      expect(f.step).toBe(i + 1);
      expect(f.time).toBeGreaterThan(end);
      expect(f.mag).toBeGreaterThan(BIG_QUAKE_MAG);
      expect(f.windowStart).toBeLessThanOrEqual(f.time);
      expect(f.windowEnd).toBeGreaterThanOrEqual(f.time);
      expect(f.radiusKm).toBeCloseTo(500);
      expect(f.score).toBeGreaterThan(0.5);
      expect(f.score).toBeLessThanOrEqual(1);
      expect(f.region).toMatch(/Testville, Tonga/);
      if (i > 0) expect(f.time).toBeGreaterThanOrEqual(res.forecasts[i - 1].time);
    });
    // One day apart, starting one day after the last catalog event.
    expect(res.forecasts[0].time - end).toBeCloseTo(MS_PER_DAY, -3);
    expect(res.forecasts[0].lon).toBeCloseTo(events.at(-1)!.lon + 0.5);
  });

  it("does not mutate the input catalog", () => {
    const events = catalog(30);
    const copy = events.map((e) => ({ ...e }));
    forecastBigQuakes(biasGenome({ logHours: 3, dLat: 0, dLon: 0, mag: 7 }), events);
    expect(events).toEqual(copy);
  });

  it("returns nothing when the model never predicts above the threshold", () => {
    const res = forecastBigQuakes(
      biasGenome({ logHours: Math.log1p(12), dLat: 0, dLon: 0, mag: 5.8 }),
      catalog(30),
      { maxSteps: 50 }
    );
    expect(res.forecasts).toHaveLength(0);
    expect(res.stoppedReason).toBe("maxSteps");
    expect(res.stepsRun).toBe(50);
  });

  it("honours minMag, count and notBefore", () => {
    const events = catalog(30);
    const genome = biasGenome({ logHours: Math.log1p(24), dLat: 0, dLon: 0, mag: 6.5 });
    const end = events.at(-1)!.time;
    const res = forecastBigQuakes(genome, events, {
      count: 3,
      minMag: 6.2,
      notBefore: end + 10 * MS_PER_DAY
    });
    expect(res.forecasts).toHaveLength(3);
    expect(res.forecasts[0].time).toBeGreaterThan(end + 10 * MS_PER_DAY);
    expect(res.forecasts[0].step).toBe(11);

    const none = forecastBigQuakes(genome, events, { minMag: 7 });
    expect(none.forecasts).toHaveLength(0);
  });

  it("excludes predictions at the catalog end (zero time gap)", () => {
    const res = forecastBigQuakes(
      biasGenome({ logHours: 0, dLat: 0, dLon: 0, mag: 7 }),
      catalog(30),
      { maxSteps: 20 }
    );
    expect(res.forecasts).toHaveLength(0);
  });

  it("stops at the horizon", () => {
    const res = forecastBigQuakes(
      biasGenome({ logHours: Math.log1p(24 * 60), dLat: 0, dLon: 0, mag: 5 }),
      catalog(30),
      { horizonDays: 100 }
    );
    expect(res.stoppedReason).toBe("horizon");
    expect(res.stepsRun).toBe(2);
  });

  it("stops when the rollout degenerates to a pole", () => {
    const res = forecastBigQuakes(
      biasGenome({ logHours: Math.log1p(6), dLat: 40, dLon: 0, mag: 7 }),
      catalog(30)
    );
    expect(res.stoppedReason).toBe("degenerate");
    expect(res.forecasts.every((f) => Math.abs(f.lat) < 89.9)).toBe(true);
    expect(res.forecasts.length).toBeLessThan(5);
  });

  it("stops when magnitude saturates at the output cap", () => {
    const res = forecastBigQuakes(
      biasGenome({ logHours: Math.log1p(6), dLat: 0, dLon: 0, mag: 12 }),
      catalog(30)
    );
    expect(res.stoppedReason).toBe("degenerate");
    expect(res.stepsRun).toBe(1);
    expect(res.forecasts).toHaveLength(0);
  });

  it("handles an empty catalog", () => {
    const res = forecastBigQuakes(biasGenome({ logHours: 1, dLat: 0, dLon: 0, mag: 7 }), []);
    expect(res.forecasts).toEqual([]);
    expect(res.stepsRun).toBe(0);
  });

  it("works with an evolved best genome and labels itself experimental", () => {
    const events = catalog(80);
    const rng = rngFrom(4);
    const cfg = { ...DEFAULT_GA_CONFIG, populationSize: 12 };
    let state = initPopulation(events, 60, cfg, rng);
    state = evolveOneGeneration(state, events, 60, cfg, rng);
    const res = forecastBigQuakes(state.best.genome, events, { maxSteps: 60 });
    expect(res.forecasts.length).toBeLessThanOrEqual(5);
    for (const f of res.forecasts) {
      expect(f.mag).toBeGreaterThan(6);
      expect(f.time).toBeGreaterThan(res.anchorTime);
    }
    expect(FORECAST_DISCLAIMER).toMatch(/Experimental.*Not a real earthquake forecast/);
  });
});
