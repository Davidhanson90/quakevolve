# Changelog

## Unreleased

- **Experimental** "Next 5 predicted M>6.0 events" panel: while training, the current best genome is
  rolled forward past the end of the catalog and the first five predicted M>6.0 events are listed
  (date + window, lat/lon + nearest catalog region, magnitude, uncalibrated self-score) and drawn on
  the map. Clearly labelled "Experimental model output. Not a real earthquake forecast."
- `forecastBigQuakes` rollout (`src/model/forecast.ts`) and offline nearest-place lookup (`src/data/places.ts`) with tests

## 0.1.0 — 2026-09-23

- Initial public release of **quakevolve**
- Bundled USGS M≥5.5 global catalog snapshot (2018–2024)
- Browser-only genetic algorithm evolving linear next-event predictors
- Walk-forward soft fitness (time / region / magnitude) with train + holdout
- Lit playground: Train/Pause/Reset, fitness chart, canvas map, prediction vs actual replay
- Vitest coverage for features, genome bounds, fitness ranking, dataset validation
- GitHub Actions verify + Pages deploy
