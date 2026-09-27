import { describe, expect, it } from "vitest";
import { MS_PER_DAY, MS_PER_HOUR, type QuakeEvent } from "../data/types.js";
import { FEATURE_DIM } from "../features/extract.js";
import { GENOME_LENGTH, HEAD_COUNT, WEIGHTS_PER_HEAD, type Genome } from "./genome.js";
import {
  BANNER_LOOKAHEAD_STEPS,
  BANNER_MIN_MAG,
  BANNER_THROTTLE_MS,
  BannerTracker,
  bannerFallbackText,
  predictionSignature,
  relativeTimeHint,
  type BannerInput
} from "./banner.js";
import { DEFAULT_LOOKAHEAD_STEPS, forecastNextBigQuake, startOfNextUtcDay } from "./forecast.js";

/** Catalog with a slider-like floor: magnitudes floor, floor+0.2, … (all below 6.0 for floor 4.5). */
function catalog(n: number, floor = 4.5, place = "Testville, Tonga"): QuakeEvent[] {
  const out: QuakeEvent[] = [];
  let t = Date.UTC(2026, 8, 1);
  for (let i = 0; i < n; i++) {
    out.push({ id: `c${i}`, time: t, lat: -20 + (i % 5), lon: 170 + (i % 3), mag: floor + (i % 4) * 0.2, place });
    t += 12 * MS_PER_HOUR;
  }
  return out;
}

function biasGenome(mag: number, timeTol = 0.5, dLat = 0, magFromMag = 0): Genome {
  const genes = new Float64Array(GENOME_LENGTH);
  const biases = [Math.log1p(24), dLat, 0, mag];
  for (let h = 0; h < HEAD_COUNT; h++) genes[h * WEIGHTS_PER_HEAD + FEATURE_DIM] = biases[h];
  genes[3 * WEIGHTS_PER_HEAD + 0] = magFromMag; // weight on the current-magnitude feature
  const base = HEAD_COUNT * WEIGHTS_PER_HEAD;
  genes[base] = timeTol;
  genes[base + 1] = 5;
  genes[base + 2] = 0.5;
  return { genes };
}

const REF = startOfNextUtcDay(Date.UTC(2026, 8, 27, 11));

function input(genome: Genome, events: QuakeEvent[], extra: Partial<BannerInput> = {}): BannerInput {
  return { genome, fitness: 0.3, generation: 0, events, referenceTime: REF, catalogMinMag: 4.5, ...extra };
}

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("BannerTracker: fixed M6.0 prediction", () => {
  it("always looks for M≥6.0, whatever catalog floor the genome was trained on", () => {
    expect(BANNER_MIN_MAG).toBe(6);
    for (const floor of [4.5, 5.5, 6.5]) {
      const tr = new BannerTracker();
      tr.offer(input(biasGenome(6.3), catalog(40, floor), { catalogMinMag: floor }));
      const p = tr.state.snapshot!.forecast.prediction!;
      expect(p.mag).toBeGreaterThanOrEqual(6);
      expect(p.time).toBeGreaterThanOrEqual(REF);
      expect(p.step).toBe(1);
    }
    const low = new BannerTracker();
    low.offer(input(biasGenome(5.9), catalog(40, 4.5)));
    const fc = low.state.snapshot!.forecast;
    expect(fc.prediction).toBeNull();
    expect(fc.stepsRun).toBe(BANNER_LOOKAHEAD_STEPS);
    expect(bannerFallbackText(fc)).toBe("No M6.0+ predicted in the next 30 events. The very next predicted event is M5.90.");
  });

  it("looks ahead 30 predicted events (the candidates panel stays at 10)", () => {
    expect(BANNER_LOOKAHEAD_STEPS).toBe(30);
    expect(DEFAULT_LOOKAHEAD_STEPS).toBe(10);
    // Magnitude creeps up 0.07 per predicted event from the last catalog event (M5.1) → first M≥6.0 at step 13.
    const creeping = biasGenome(0.07, 0.5, 0, 1);
    const events = catalog(40, 4.5);
    expect(events.at(-1)!.mag).toBeCloseTo(5.1);
    expect(forecastNextBigQuake(creeping, events, { minMag: 6, referenceTime: REF }).prediction).toBeNull();
    const tr = new BannerTracker();
    tr.offer(input(creeping, events));
    const p = tr.state.snapshot!.forecast.prediction!;
    expect(p.step).toBe(13);
    expect(p.mag).toBeGreaterThanOrEqual(6);
    // …but not beyond 30: a slower creep (0.02/step → step 45) still falls back.
    const slow = new BannerTracker();
    slow.offer(input(biasGenome(0.02, 0.5, 0, 1), events));
    expect(slow.state.snapshot!.forecast.prediction).toBeNull();
    expect(slow.state.snapshot!.forecast.stepsRun).toBe(30);
  });

  it("names the location from placeEvents (full catalog) when given", () => {
    const tr = new BannerTracker();
    tr.offer(input(biasGenome(6.3), catalog(40, 6.5, "Sparse, Nowhere"), { placeEvents: catalog(40, 4.5, "Kermadec Islands") }));
    expect(tr.state.snapshot!.forecast.prediction!.region).toBe("near Kermadec Islands");
  });
});

describe("BannerTracker: throttling and change detection", () => {
  it("recomputes at most once per throttle window unless forced, remembering skipped updates", () => {
    const c = clock(1000);
    const events = catalog(40);
    const tr = new BannerTracker(BANNER_THROTTLE_MS, c.now);
    expect(tr.offer(input(biasGenome(6.2), events))).toBe(true);
    const first = tr.state.snapshot!;

    c.advance(100);
    expect(tr.offer(input(biasGenome(6.8), events, { generation: 3 }))).toBe(false);
    expect(tr.pending).toBe(true);
    expect(tr.state.snapshot).toBe(first);

    c.advance(BANNER_THROTTLE_MS);
    expect(tr.offer(input(biasGenome(6.8), events, { generation: 4 }))).toBe(true);
    expect(tr.pending).toBe(false);
    expect(tr.state.snapshot!.forecast.prediction!.mag).toBeCloseTo(6.8);
    expect(tr.state.snapshot!.version).toBe(first.version + 1);
    expect(tr.state.snapshot!.foundGeneration).toBe(3); // first seen while throttled

    c.advance(1);
    expect(tr.offer(input(biasGenome(7.1), events), true)).toBe(true);
    expect(tr.state.snapshot!.forecast.prediction!.mag).toBeCloseTo(7.1);
  });

  it("does nothing for the same best genome, and keeps its generation of origin", () => {
    const c = clock();
    const events = catalog(40);
    const tr = new BannerTracker(BANNER_THROTTLE_MS, c.now);
    tr.offer(input(biasGenome(6.2), events, { generation: 2 }));
    c.advance(10_000);
    expect(tr.offer(input(biasGenome(6.2), events, { generation: 9 }), true)).toBe(false);
    expect(tr.state.snapshot!.foundGeneration).toBe(2);
    expect(tr.state.snapshot!.generation).toBe(2);
  });

  it("only bumps the flash version when the displayed prediction changes", () => {
    const c = clock();
    const events = catalog(40);
    const tr = new BannerTracker(BANNER_THROTTLE_MS, c.now);
    tr.offer(input(biasGenome(6.2, 0.5), events));
    const v = tr.state.snapshot!.version;
    c.advance(BANNER_THROTTLE_MS);
    // Different genome (time-tolerance gene), same predicted time/mag/place → no flash.
    expect(tr.offer(input(biasGenome(6.2, 0.9), events))).toBe(true);
    expect(tr.state.snapshot!.version).toBe(v);
    c.advance(BANNER_THROTTLE_MS);
    tr.offer(input(biasGenome(6.2, 0.9, 5), events));
    expect(tr.state.snapshot!.version).toBe(v + 1);
  });
});

describe("BannerTracker: never empty", () => {
  it("has no snapshot only before the first offer; stale keeps the last value", () => {
    const c = clock();
    const tr = new BannerTracker(BANNER_THROTTLE_MS, c.now);
    expect(tr.state.snapshot).toBeNull();
    expect(tr.markStale()).toBe(false);

    const events = catalog(40);
    tr.offer(input(biasGenome(6.4), events));
    const last = tr.state.snapshot!;
    expect(tr.markStale()).toBe(true);
    expect(tr.markStale()).toBe(false);
    expect(tr.state).toMatchObject({ snapshot: last, stale: true, staleReason: "updating…" });
  });

  it("slider rebuild: new catalog replaces the stale value at once, even inside the throttle window", () => {
    const c = clock();
    const tr = new BannerTracker(BANNER_THROTTLE_MS, c.now);
    tr.offer(input(biasGenome(6.4), catalog(40, 5.5)));
    tr.markStale();
    c.advance(10);
    // Same genome, new (filtered) events array → recompute, not throttled.
    expect(tr.offer(input(biasGenome(6.4), catalog(60, 4.5)))).toBe(true);
    expect(tr.state.stale).toBe(false);
    expect(tr.state.snapshot).not.toBeNull();
  });

  it("while stale, unforced offers from the old population are held back", () => {
    const c = clock();
    const events = catalog(40);
    const tr = new BannerTracker(BANNER_THROTTLE_MS, c.now);
    tr.offer(input(biasGenome(6.4), events));
    const last = tr.state.snapshot;
    tr.markStale();
    c.advance(10_000);
    expect(tr.offer(input(biasGenome(6.9), events, { generation: 50 }))).toBe(false);
    expect(tr.pending).toBe(true);
    expect(tr.state).toMatchObject({ snapshot: last, stale: true });
  });

  it("slider returned to the same value: a forced re-offer of the same genome clears the stale flag", () => {
    const events = catalog(40);
    const tr = new BannerTracker();
    tr.offer(input(biasGenome(6.4), events));
    const version = tr.state.snapshot!.version;
    tr.markStale();
    expect(tr.offer(input(biasGenome(6.4), events), true)).toBe(true);
    expect(tr.state.stale).toBe(false);
    expect(tr.state.snapshot!.version).toBe(version);
  });

  it("reset / rebuild / pause sequence never yields an empty state", () => {
    const c = clock();
    const tr = new BannerTracker(BANNER_THROTTLE_MS, c.now);
    const a = catalog(40, 5.5);
    const b = catalog(80, 4.5);
    const steps: (() => void)[] = [
      () => tr.offer(input(biasGenome(5.8), a), true), // initial population (fallback text)
      () => tr.offer(input(biasGenome(6.3), a, { generation: 1 })), // training (throttled)
      () => tr.offer(input(biasGenome(6.6), a, { generation: 2 })),
      () => tr.offer(input(biasGenome(6.6), a, { generation: 2 }), true), // pause
      () => tr.markStale("updating…"), // slider moved
      () => tr.offer(input(biasGenome(5.1), b), true), // rebuilt population
      () => tr.markStale("too few events"), // threshold too high: keep last
      () => tr.offer(input(biasGenome(6.9), b, { referenceTime: REF + MS_PER_DAY }), true) // reset next day
    ];
    for (const step of steps) {
      step();
      c.advance(50);
      const s = tr.state;
      expect(s.snapshot).not.toBeNull();
      const fc = s.snapshot!.forecast;
      const text = fc.prediction ? `M${fc.prediction.mag.toFixed(2)}` : bannerFallbackText(fc);
      expect(text.length).toBeGreaterThan(0);
    }
    expect(tr.state.snapshot!.forecast.prediction!.mag).toBeCloseTo(6.9);
  });
});

describe("banner text helpers", () => {
  it("fallback text covers degenerate and empty look-aheads", () => {
    const base = { anchorTime: 0, lastEventTime: 0, prediction: null, nextMag: null };
    expect(bannerFallbackText({ ...base, stepsRun: 0, stoppedReason: "empty" })).toMatch(/No catalog/);
    expect(bannerFallbackText({ ...base, stepsRun: 3, stoppedReason: "degenerate" })).toMatch(/No M6\.0\+ predicted: the look-ahead left the data range .* after 3 events/);
    expect(bannerFallbackText({ ...base, stepsRun: 30, stoppedReason: "belowThreshold" })).toBe("No M6.0+ predicted in the next 30 events.");
    expect(predictionSignature({ ...base, stepsRun: 30, stoppedReason: "belowThreshold" })).toBe("belowThreshold:30:-");
  });

  it("relativeTimeHint picks a readable unit", () => {
    const now = Date.UTC(2026, 8, 27, 12);
    const h = MS_PER_HOUR;
    expect(relativeTimeHint(now + 20 * 60_000, now)).toBe("in <1 h");
    expect(relativeTimeHint(now + 5 * h, now)).toBe("in ~5 h");
    expect(relativeTimeHint(now + 12 * MS_PER_DAY, now)).toBe("in ~12 days");
    expect(relativeTimeHint(now + 95 * MS_PER_DAY, now)).toBe("in ~3 months");
    expect(relativeTimeHint(now + 3 * 365 * MS_PER_DAY, now)).toBe("in ~3 years");
    expect(relativeTimeHint(now - 3 * MS_PER_DAY, now)).toBe("~3 days ago");
  });
});
