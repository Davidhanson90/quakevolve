/**
 * Fitness scoring configuration — every constant that decides how a prediction is scored lives
 * here. Each walk-forward step predicts the NEXT event and is scored per component as
 * `exp(-|error| / tolerance)` (1 = exact, 0.37 = off by one tolerance, → 0 far away):
 *
 *   fitness = 0.35 · mean(time) + 0.40 · mean(location) + 0.25 · weightedMean(magnitude)
 */

/** Component weights (sum to 1). */
export const SCORE_WEIGHTS = { time: 0.35, region: 0.4, mag: 0.25 } as const;

/**
 * FIXED tolerances (they used to be evolved genes, which let the GA raise its own score simply by
 * widening them — a wider tolerance always scores higher). Chosen a priori from physical /
 * catalog scales, not tuned against GA results:
 *
 * - `timeLogHours = 1.0` — the time target is log1p(hours until the next event), so one unit is
 *   a factor of e ≈ 2.7 in waiting time: guessing 10 h when it was 27 h scores 0.37. (For
 *   reference, the median miss of the "median gap" guess on the M≥5.5 training set is ≈0.9.)
 * - `distKm = 300` — roughly the size of a large aftershock zone / rupture (M7–8 ruptures are
 *   ~100–300 km long): within a few hundred km means "same seismic sequence or region". About 16%
 *   of consecutive M≥5.5 events are that close; most are thousands of km apart and score ≈0.
 * - `mag = 0.5` — half a magnitude unit: a bit more than the typical spread between magnitude
 *   types / agencies (~0.2–0.3), and a clearly different size class (≈5.6× the energy).
 */
export const SCORE_TOLERANCES = {
  timeLogHours: 1.0,
  distKm: 300,
  mag: 0.5
} as const;

/**
 * Big-quake weighting of the MAGNITUDE component. Each step's magnitude score is weighted by the
 * ACTUAL next event's magnitude M relative to the slider minimum Mmin:
 *
 *   w(M) = min(cap, 10^(b · (M − Mmin)))      with b = 0.5, cap = 10
 *
 * and the magnitude component is the weighted mean Σ w·s / Σ w (so it stays in [0, 1]).
 *
 * Why: magnitudes follow Gutenberg–Richter, N(≥M) ∝ 10^(−b_GR·(M − Mmin)) with b_GR ≈ 1, so an
 * unweighted mean is dominated by events just above the minimum and a model that always predicts
 * ~Mmin scores well while missing every big quake. b = 1 would give each magnitude band equal
 * total weight (rare giants dominate); b = 0.5 is the square root of that — halfway between
 * "every event counts the same" and "every magnitude band counts the same". The cap (reached at
 * M = Mmin + 2, e.g. M7.5 at the default M5.5 slider) stops a handful of M8–9 events from
 * dominating. Time and location are not weighted.
 */
export const MAG_WEIGHT = { b: 0.5, cap: 10 } as const;

/** Weight of a step's magnitude score given the actual next-event magnitude and the slider minimum. */
export function magWeight(actualMag: number, minMag: number, b: number = MAG_WEIGHT.b, cap: number = MAG_WEIGHT.cap): number {
  return Math.min(cap, 10 ** (b * Math.max(0, actualMag - minMag)));
}
