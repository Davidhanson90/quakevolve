# Changelog

## Unreleased

- **Experimental** top-3 candidates panel: the three fittest distinct genomes each show one prediction
  for the next M>6.0 event **after today** (date + window, region + lat/lon, magnitude, uncalibrated score),
  drawn as colour-coded geodesic circles (radius = genome location tolerance) with a legend.
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
