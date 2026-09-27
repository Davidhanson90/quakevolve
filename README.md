# quakevolve

An educational **genetic-algorithm playground** that evolves simple earthquake-event predictors against a historical catalog.

**Live demo:** [https://davidhanson90.github.io/quakevolve/](https://davidhanson90.github.io/quakevolve/)

> **Honest framing:** Earthquake prediction in the real world is **not** a solved problem. This app does **not** claim operational forecasting. Fitness is measured by walking forward through a historical USGS catalog and scoring how well a genome predicts the *next* event’s time gap, location, and magnitude. Treat it as a GA teaching demo.

No TensorFlow.js, no API keys, no backend. Pure TypeScript + Lit + Vite. The catalog is a **bundled JSON snapshot** so GitHub Pages works offline.

## What you can learn by playing

- How a **genome** (typed weights + tolerances) can be crossed over and mutated
- **Walk-forward fitness**: only past events are visible when scoring a prediction of the next one
- Soft scoring that rewards being *close* (time, distance, magnitude), not only exact bins
- Train vs **holdout** generalization on a later time slice
- Why “looks good on history” is still not real-world prediction

## How to use

1. Open the demo (or `npm start` locally)
2. Optionally tweak population size and mutation rate
3. Hit **Train** — watch generation count, best train fitness, and the fitness chart climb
4. Compare **holdout** soft-score (yellow dashed line) as a reality check
5. On the map: yellow ring = model’s next-event guess, green = actual next event during replay
6. Watch the **Top 3 candidates (experimental)** panel and the coloured circles on the map update as the GA evolves
7. **Pause** / **Reset** as needed

## Quick start

```bash
npm install
npm start
```

Open the URL Vite prints (usually `http://localhost:5173/quakevolve/`).

Other scripts:

```bash
npm test           # vitest
npm run lint       # eslint
npm run build      # typecheck + production Vite build → dist/
npm run build:verify
npm run data:update  # refresh public/data/earthquakes.json from USGS (2018-01-01 → now, M≥5.5)
```

## Algorithm summary

**Prediction target** (for each event *i*, given history `0..i`):

| Head | Target |
|------|--------|
| Time | `log1p(hours until event i+1)` |
| Region | lat/lon of event *i+1* as offset from event *i* |
| Magnitude | magnitude of event *i+1* |

**Features** from recent history (11-D): magnitude, log hours since previous, mean mag of last 5/20, global counts in 7d/30d, counts in the same 30° cell, log hours since last event in that cell, normalized lat/lon, mag anomaly vs last-20 mean.

**Genome:** four linear heads (weights + bias) plus three tolerance genes used by soft scoring. Operators: tournament selection, uniform / single-point crossover, Gaussian-ish mutation, elitism.

**Fitness:** weighted soft scores — time 35%, region (haversine) 40%, magnitude 25% — averaged over the train window. Holdout uses the later 30% of the timeline.

## Experimental: top 3 candidates, next M>6.0 event after today

> **Experimental. Not a real earthquake forecast.** A linear toy model evolved with a genetic
> algorithm cannot predict real earthquakes. This panel shows what the fittest genomes “believe”.

Every generation, the three fittest **distinct** genomes in the population (`topCandidates`,
`src/model/candidates.ts`) each give **one** prediction (`forecastNextBigQuake`, `src/model/forecast.ts`):

1. Predict the next event from the real catalog. If it is not above M6.0, append it as if it happened
   and predict again, looking ahead at most **10** predicted events (long chains drift).
2. The first predicted event above M6.0 is the candidate’s prediction. Its predicted waiting time is
   counted from the **start of tomorrow (UTC)** rather than from the last catalog event — the catalog runs
   up to today, so the quiet time since the last event is treated as memoryless — which means every
   prediction is dated **after today**.
3. If nothing above M6.0 turns up (or the look-ahead degenerates to a pole / the M9.5 cap), the row says
   so instead of inventing one.

**Consistent:** there is no randomness at forecast time. Results are cached by a hash of the genome’s
genes, so a candidate’s row only changes when the top-3 membership or a genome actually changes. The
reference date (“tomorrow”) is fixed when the page loads or you press Reset.

| Column | Meaning |
|--------|---------|
| Candidate | Rank 1–3 (colour), short genome id, train fitness, generation it entered the top 3 |
| Date (UTC) | Predicted time, plus a window from the genome’s time-tolerance gene |
| Location | Region name from the nearest real catalog event’s USGS `place` (offline), lat/lon, and the genome’s location tolerance |
| Mag | Predicted magnitude |
| Score | P(M > 6.0) if magnitude errors followed the Laplace kernel the genome is scored with (scale = magnitude-tolerance gene). **Not calibrated.** |

On the map each prediction is a **geodesic circle** (real km, not pixels) centred on the predicted location,
with radius = that genome’s location tolerance, coloured 1/2/3 as in the legend.

Caveat: the evolved magnitude head is weak (it often predicts small next events), so “no M>6.0 prediction”
rows are common and expected.

## Dataset

| Field | Value |
|-------|-------|
| Source | [USGS FDSN event API](https://earthquake.usgs.gov/fdsnws/event/1/) (public catalog) |
| Filters | `minmagnitude=5.5`, `starttime=2018-01-01`, `endtime` = time of the last refresh, global |
| Bundled file | `public/data/earthquakes.json` (~4.1k events to 2026-09-26, &lt; 500 KB) |
| Fields kept | `id, time, lat, lon, mag, place` sorted by time |

Refresh the snapshot (commit the result for Pages):

```bash
npm run data:update                           # 2018-01-01 → now
npm run data:update -- --end 2026-09-27T10:59:00
```

`scripts/update-earthquakes.mjs` queries the USGS FDSN event service (GeoJSON, `orderby=time-asc`) and
writes the same compact format. The train/holdout split stays chronological 70/30, so holdout covers the
most recent ~30% of events.

## Tech stack

- TypeScript + Vite (`base: '/quakevolve/'`)
- Lit web components
- From-scratch GA + feature extraction (no TF.js)
- Vitest + ESLint
- GitHub Actions → verify on `main` + deploy `dist/` to GitHub Pages

## Project layout

```
src/
  data/       # load + validate bundled catalog
  features/   # history feature extraction + bins
  model/      # genome, predict, soft fitness
  ga/         # population, select, crossover, mutate
  ui/         # Lit playground, fitness chart, map
  styles/     # theme
public/data/earthquakes.json
.github/workflows/
  verify-main.yml
  deploy-pages.yml
```

## License

MIT
