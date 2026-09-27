# Changelog

## Unreleased

- **Headline on the map:** the banner's biggest-predicted-quake is drawn on the existing canvas map as a pink
  star in a white crosshair with a true-scale 300 km geodesic ring and an “M… headline” label (legend entry,
  gentle pulse that respects `prefers-reduced-motion`, antimeridian-safe). It uses the banner's throttled
  snapshot, so both always agree. The banner's place name now scrolls to and flashes the marker, and an
  “Open in Google Maps ↗” link (3-decimal coordinates, normalised longitude, new tab) sits under it.
  No new dependencies.

- **Fitness fixes.** (1) The three evolved tolerance genes are gone: tolerances are fixed at 1.0 log-hour,
  300 km and 0.5 magnitude (`src/model/scoring-config.ts`), because the GA was widening them to inflate its own
  score. Genomes are now 48 genes; `genomeFromGenes` accepts the old 51-gene shape and drops the extras.
  (2) The magnitude part of fitness is a weighted mean with `w = min(10, 10^(0.5·(M − Mmin)))` on the actual
  next magnitude, so missing big quakes costs more. (3) New **no-learning baseline** (same place, median training
  gap, median training magnitude) scored the same way on train and holdout, shown next to the best genome with a
  **skill vs baseline** figure and a dotted line on the fitness chart. Selection still uses only the model's own
  train fitness. Candidate/banner windows and circle radii now use the fixed tolerances.

- Banner now shows the **next biggest predicted quake**: the largest-magnitude event in the best genome's next
  30 predicted events (earliest on ties), with its position in the chain ("#k of 30"). The fixed M6.0 threshold
  and the "No M6.0+ predicted" fallback are gone; text fallbacks remain only for an empty catalog or a chain that
  leaves the data range at its first step. New `forecastBiggestQuake`; the top-3 candidates panel is unchanged.

- Banner look-ahead extended to **30** predicted events (`BANNER_LOOKAHEAD_STEPS`); the top-3 candidates panel
  stays at 10. Fallback now reads "No M6.0+ predicted in the next 30 events".

- **Headline banner (experimental):** sticky bar at the top showing the best genome's next predicted **M≥6.0**
  event after today (UTC time + "in ~N days", magnitude, region + lat/lon), its fitness and generation. Fixed 6.0,
  independent of the slider. Throttled to one recompute per 500 ms, only when the best genome changes; flashes on
  change; never blank (initial population's prediction before training, dimmed "updating…" during slider rebuilds,
  explicit "No M6.0+ predicted in the next N events" fallback).

- **Minimum-magnitude slider** (`M ≥ 4.5` … `M ≥ 7.5`, step 0.1, default `M ≥ 5.5`). One threshold drives the
  catalog: map, train/holdout split, replay, walk-forward predictions and the experimental candidates' target
  (`M ≥ threshold`, was a fixed M>6.0). Lowering it shows more events and more predictions (counts shown next to
  the slider). Changing it (debounced) resets the population and retrains cleanly.
- Catalog snapshot lowered to **M≥4.5** (66,281 USGS events, 2018-01-01 → 2026-09-27) in a compact
  delta/dictionary-encoded format (≈2.1 MB); `npm run data:update` pages the USGS query by year.
- Map and replay now show the best genome's walk-forward predictions for every event in the catalog's last 90 days.
- Faster fitness: genome-independent features are cached per event set and each fitness call scores at most 3,000
  evenly spaced positions (the default M≥5.5 windows are still scored in full). The map pre-renders the catalog
  layer once and draws every event instead of a 2,500-dot sample.

- **Experimental** top-3 candidates panel: the three fittest distinct genomes each show one prediction
  for the next M>6.0 event **after today** (date + window, region + lat/lon, magnitude, uncalibrated score),
  drawn as colour-coded geodesic circles (radius = genome location tolerance; now the fixed 300 km) with a legend.
  Deterministic and cached per genome, so a row only changes when that genome changes. Replaces the
  unreleased chained "next 5" list from the best genome (PR #1). Labelled "Experimental. Not a real earthquake forecast."
- Catalog refreshed to 2026-09-26 (4,065 USGS M≥5.5 events) and `npm run data:update`
  (`scripts/update-earthquakes.mjs`) added to regenerate it from the USGS FDSN event service.

## 0.1.0 — 2026-09-23

- Initial public release of **quakevolve**
- Bundled USGS M≥5.5 global catalog snapshot (2018–2024)
- Browser-only genetic algorithm evolving linear next-event predictors
- Walk-forward soft fitness (time / region / magnitude) with train + holdout
- Lit playground: Train/Pause/Reset, fitness chart, canvas map, prediction vs actual replay
- Vitest coverage for features, genome bounds, fitness ranking, dataset validation
- GitHub Actions verify + Pages deploy
