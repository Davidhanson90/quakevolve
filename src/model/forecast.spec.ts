import { describe, expect, it } from "vitest";
import { MS_PER_DAY, MS_PER_HOUR, type QuakeEvent } from "../data/types.js";
import { FEATURE_DIM } from "../features/extract.js";
import { GENOME_LENGTH, HEAD_COUNT, WEIGHTS_PER_HEAD, type Genome } from "./genome.js";
import {
  BIG_QUAKE_MAG,
  DEFAULT_LOOKAHEAD_STEPS,
  FORECAST_DISCLAIMER,
  exceedanceScore,
  forecastNextBigQuake,
  startOfNextUtcDay
} from "./forecast.js";

function catalog(n: number): QuakeEvent[] {
  const out: QuakeEvent[] = [];
  let t = Date.UTC(2026, 8, 1);
  for (let i = 0; i < n; i++) {
    out.push({
      id: `c${i}`,
      time: t,
      lat: -20 + (i % 5),
      lon: 170 + (i % 3),
      mag: 5.5 + (i % 4) * 0.2,
      place: i % 2 === 0 ? `${10 + i} km NE of Testville, Tonga` : undefined
    });
    t += 12 * MS_PER_HOUR;
  }
  return out;
}

/** Bias-only heads (predict() does not clamp genes); optional weight on the `mag` feature. */
function biasGenome(b: { logHours: number; dLat: number; dLon: number; mag: number; magFromMag?: number }): Genome {
  const genes = new Float64Array(GENOME_LENGTH);
  const biases = [b.logHours, b.dLat, b.dLon, b.mag];
  for (let h = 0; h < HEAD_COUNT; h++) genes[h * WEIGHTS_PER_HEAD + FEATURE_DIM] = biases[h];
  genes[3 * WEIGHTS_PER_HEAD + 0] = b.magFromMag ?? 0;
  const base = HEAD_COUNT * WEIGHTS_PER_HEAD;
  genes[base] = 0.5; // timeTol (log-hours)
  genes[base + 1] = 5; // → 500 km
  genes[base + 2] = 0.5; // magTol
  return { genes };
}

const DAY_GAP = Math.log1p(24);

describe("exceedanceScore", () => {
  it("is 0.5 at the threshold and monotonic in magnitude", () => {
    expect(exceedanceScore(6, 6, 0.5)).toBeCloseTo(0.5);
    expect(exceedanceScore(6.5, 6, 0.5)).toBeGreaterThan(0.5);
    expect(exceedanceScore(5.5, 6, 0.5)).toBeLessThan(0.5);
    expect(exceedanceScore(7.5, 6, 0.5)).toBeGreaterThan(exceedanceScore(6.5, 6, 0.5));
    expect(exceedanceScore(9, 6, 0)).toBeCloseTo(1);
  });
});

describe("startOfNextUtcDay", () => {
  it("returns midnight UTC of the following day", () => {
    expect(startOfNextUtcDay(Date.UTC(2026, 8, 27, 10, 59))).toBe(Date.UTC(2026, 8, 28));
    expect(startOfNextUtcDay(Date.UTC(2026, 8, 27))).toBe(Date.UTC(2026, 8, 28));
    expect(startOfNextUtcDay(Date.UTC(2026, 11, 31, 23, 59))).toBe(Date.UTC(2027, 0, 1));
  });
});

describe("forecastNextBigQuake", () => {
  const events = catalog(30);
  const last = events.at(-1)!;

  it("dates the prediction from the reference date (after today)", () => {
    const ref = last.time + 3 * MS_PER_DAY;
    const res = forecastNextBigQuake(biasGenome({ logHours: DAY_GAP, dLat: 0, dLon: 0.5, mag: 6.5 }), events, {
      referenceTime: ref
    });
    expect(res.stoppedReason).toBe("found");
    expect(res.anchorTime).toBe(ref);
    expect(res.lastEventTime).toBe(last.time);
    expect(res.nextMag).toBeCloseTo(6.5);
    const p = res.prediction!;
    expect(p.step).toBe(1);
    expect(p.time).toBeCloseTo(ref + MS_PER_DAY, -3);
    expect(p.time).toBeGreaterThan(ref);
    expect(p.windowStart).toBeGreaterThanOrEqual(ref);
    expect(p.windowStart).toBeLessThanOrEqual(p.time);
    expect(p.windowEnd).toBeGreaterThanOrEqual(p.time);
    expect(p.lat).toBeCloseTo(last.lat);
    expect(p.lon).toBeCloseTo(last.lon + 0.5);
    expect(p.mag).toBeGreaterThan(BIG_QUAKE_MAG);
    expect(p.radiusKm).toBeCloseTo(500);
    expect(p.score).toBeGreaterThan(0.5);
    expect(p.region).toMatch(/Testville, Tonga/);
  });

  it("anchors on the last event when there is no (or an earlier) reference date", () => {
    const g = biasGenome({ logHours: DAY_GAP, dLat: 0, dLon: 0, mag: 7 });
    expect(forecastNextBigQuake(g, events).prediction!.time).toBeCloseTo(last.time + MS_PER_DAY, -3);
    const early = forecastNextBigQuake(g, events, { referenceTime: last.time - MS_PER_DAY });
    expect(early.anchorTime).toBe(last.time);
  });

  it("looks ahead through smaller predicted events to the first one above M6", () => {
    // mag_next = mag_last + 0.2 → last catalog mag 5.7 → 5.9 → 6.1
    const g = biasGenome({ logHours: DAY_GAP, dLat: 0, dLon: 1, mag: 0.2, magFromMag: 1 });
    const ref = last.time + MS_PER_DAY;
    const res = forecastNextBigQuake(g, events, { referenceTime: ref });
    const p = res.prediction!;
    expect(p.step).toBe(2);
    expect(p.mag).toBeCloseTo(6.1);
    expect(res.nextMag).toBeCloseTo(5.9);
    expect(p.time).toBeCloseTo(ref + 2 * MS_PER_DAY, -3);
    expect(p.windowStart).toBeGreaterThan(ref + MS_PER_DAY - 1);
    expect(p.lon).toBeCloseTo(last.lon + 2);
  });

  it("reports honestly when no M>6 event is predicted within the look-ahead", () => {
    const res = forecastNextBigQuake(biasGenome({ logHours: DAY_GAP, dLat: 0, dLon: 0, mag: 5.8 }), events);
    expect(res.prediction).toBeNull();
    expect(res.stoppedReason).toBe("belowThreshold");
    expect(res.stepsRun).toBe(DEFAULT_LOOKAHEAD_STEPS);
    expect(res.nextMag).toBeCloseTo(5.8);
    expect(forecastNextBigQuake(biasGenome({ logHours: 1, dLat: 0, dLon: 0, mag: 6.5 }), events, { minMag: 7 }).prediction).toBeNull();
  });

  it("stops when the look-ahead degenerates (pole or magnitude cap)", () => {
    const pole = forecastNextBigQuake(biasGenome({ logHours: 1, dLat: 40, dLon: 0, mag: 5 }), events);
    expect(pole.stoppedReason).toBe("degenerate");
    expect(pole.stepsRun).toBe(3);
    const cap = forecastNextBigQuake(biasGenome({ logHours: 1, dLat: 0, dLon: 0, mag: 12 }), events);
    expect(cap.stoppedReason).toBe("degenerate");
    expect(cap.stepsRun).toBe(1);
    expect(cap.prediction).toBeNull();
  });

  it("is deterministic and does not mutate the catalog", () => {
    const copy = events.map((e) => ({ ...e }));
    const g = biasGenome({ logHours: 2, dLat: 0.3, dLon: -0.4, mag: 0.25, magFromMag: 1 });
    const opts = { referenceTime: Date.UTC(2026, 8, 28) };
    const a = forecastNextBigQuake(g, events, opts);
    const b = forecastNextBigQuake(g, events, opts);
    expect(a).toEqual(b);
    expect(events).toEqual(copy);
  });

  it("handles an empty catalog", () => {
    const res = forecastNextBigQuake(biasGenome({ logHours: 1, dLat: 0, dLon: 0, mag: 7 }), [], { referenceTime: 5 });
    expect(res).toMatchObject({ prediction: null, stoppedReason: "empty", stepsRun: 0, anchorTime: 5 });
    expect(forecastNextBigQuake(biasGenome({ logHours: 1, dLat: 0, dLon: 0, mag: 7 }), []).anchorTime).toBe(0);
  });

  it("labels itself experimental", () => {
    expect(FORECAST_DISCLAIMER).toMatch(/Experimental.*Not a real earthquake forecast/);
  });
});
