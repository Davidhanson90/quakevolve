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
6. Watch the **Next 5 predicted M>6.0 events (experimental)** panel update as the GA evolves
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

## Experimental: next 5 predicted M>6.0 events

> **Experimental model output. Not a real earthquake forecast.** A linear toy model evolved on a
> 2018–2024 snapshot cannot predict real earthquakes. This panel exists to show what the genome
> “believes”, and how quickly that falls apart once it has to feed on its own guesses.

While training (every 5 generations, and on Pause/Reset) the current best genome is **rolled forward**
from the last catalog event: predict the next event, append it to the history as if it happened,
predict again (up to 250 steps / one year). Predicted events with magnitude **> 6.0** that fall after
the last catalog event are sorted by date and the first five are shown in the UI panel and as numbered
red diamonds on the map (`src/model/forecast.ts`).

Each row shows:

| Column | Meaning |
|--------|---------|
| Date (UTC) | Predicted time, plus a window from the genome’s time-tolerance gene |
| Location | lat/lon, a region name taken from the nearest real catalog event’s USGS `place` (offline), and a radius from the distance-tolerance gene |
| Mag | Predicted magnitude |
| Self-score | P(M > 6.0) if magnitude errors followed the Laplace kernel the genome is scored with (scale = magnitude-tolerance gene). **Not calibrated.** Also shows the rollout step. |

Caveats: the catalog ends on 2024-12-30, so “upcoming” dates are right after that and may already be
in the past. Rollouts drift (location walks, magnitudes escalate), so the rollout stops early if latitude
hits a pole or magnitude hits the M9.5 cap. Fewer than five rows (or none) is a normal result.

## Dataset

| Field | Value |
|-------|-------|
| Source | [USGS FDSN event API](https://earthquake.usgs.gov/fdsnws/event/1/) (public catalog) |
| Filters | `minmagnitude=5.5`, `starttime=2018-01-01`, `endtime=2024-12-31`, global |
| Bundled file | `public/data/earthquakes.json` (~3.2k events, &lt; 400 KB) |
| Fields kept | `id, time, lat, lon, mag, place` sorted by time |

Re-fetch example (optional; commit the snapshot for Pages):

```bash
curl -fsSL "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=2018-01-01&endtime=2024-12-31&minmagnitude=5.5" -o /tmp/eq.geojson
```

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
