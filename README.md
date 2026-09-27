# quakevolve

An educational **genetic-algorithm playground** that evolves simple earthquake-event predictors against a historical catalog.

**Live demo:** [https://davidhanson90.github.io/quakevolve/](https://davidhanson90.github.io/quakevolve/)

> **Honest framing:** Earthquake prediction in the real world is **not** a solved problem. This app does **not** claim operational forecasting. Fitness is measured by walking forward through a historical USGS catalog and scoring how well a genome predicts the *next* event’s time gap, location, and magnitude. Treat it as a GA teaching demo.

No TensorFlow.js, no API keys, no backend. Pure TypeScript + Lit + Vite. The catalog is a **bundled JSON snapshot** so GitHub Pages works offline.

## What you can learn by playing

- How a **genome** (typed regression weights) can be crossed over and mutated
- **Walk-forward fitness**: only past events are visible when scoring a prediction of the next one
- Soft scoring that rewards being *close* (time, distance, magnitude), not only exact bins
- Train vs **holdout** generalization on a later time slice
- Whether evolution beats a **no-learning baseline** (a dumb guess) at all
- Why “looks good on history” is still not real-world prediction

## How to use

1. Open the demo (or `npm start` locally)
2. Pick a **Minimum magnitude** (slider, `M ≥ 4.5` … `M ≥ 7.5`, default `M ≥ 5.5`). Only events at or
   above it count: they are drawn on the map, trained on, held out, replayed and predicted. Lower it to
   see more events and more predictions (see [Minimum-magnitude slider](#minimum-magnitude-slider))
3. Optionally tweak population size and mutation rate
4. Hit **Train** — watch generation count, best train fitness, and the fitness chart climb
5. Compare **holdout** soft-score (yellow dashed line) as a reality check
6. On the map: yellow squares = the best genome’s walk-forward predictions for every event in the last
   90 days of the catalog; yellow ring = the prediction currently being replayed, green = the actual event
7. Watch the **Top 3 candidates (experimental)** panel and the coloured circles on the map update as the GA evolves
8. **Pause** / **Reset** as needed

## Headline banner: next biggest predicted quake (experimental)

A sticky banner at the top of the page always shows the **biggest** event in the **current best genome's**
next **30** predicted events after today: date/time (UTC) with an “in ~N days” hint and a ±1 log-hour
window, magnitude, where it sits in the chain (“#7 of 30 in the chain”, plus the chain's magnitude range),
and location (nearest catalog region name + lat/lon ± the fixed 300 km scoring tolerance), with the genome id,
its fitness and the generation it became best. It is labelled “Experimental. Not a real earthquake forecast.”

- **No magnitude threshold.** `forecastBiggestQuake` (`src/model/forecast.ts`) chains predictions exactly like
  the candidates panel (each predicted event is appended and the next one predicted from it, dated from the
  start of tomorrow UTC) for `BANNER_LOOKAHEAD_STEPS = 30` events and returns the largest magnitude — the
  earliest one on ties. So there is always an event to show. The top-3 candidates panel is unchanged (next
  event ≥ the slider value, 10-event look-ahead).
- The chain starts from the slider-filtered catalog the genome was trained on; place names always come from
  the full catalog. Long chains drift (locations walk, magnitudes creep), so treat far steps sceptically.
- Only real failures fall back to text: an empty catalog, or a chain that leaves the data range (latitude at
  a pole or magnitude at the M9.5 cap) at its very first step. If it leaves the range later, the biggest of
  the valid steps is shown with a note.
- **Updates as the model improves** (`BannerTracker`, `src/model/banner.ts`): it recomputes only when the
  best genome changes, at most every **500 ms** while training. A skipped update is picked up on the next
  generation after the window, or immediately on Pause. The block flashes briefly when the displayed
  prediction changes.
- **Never blank:** before training it shows the initial population's best genome. Moving the slider dims the
  last prediction with “updating…” until the rebuilt population's best genome replaces it. Reset
  replaces it straight away with the new population's best. While loading it says so.
- Compact two-row layout on narrow screens; not pinned on very short (landscape phone) viewports.
- **On the map:** the same snapshot is drawn on the catalog map as the *headline marker*: a pink star inside a
  white crosshair with a true-scale 300 km geodesic ring (the fixed distance tolerance) and a label pill such as
  “M5.45 headline” (listed in the legend). Map and banner read the same throttled `BannerTracker` snapshot, so
  they always agree, including while training; the marker pulses gently (static under
  `prefers-reduced-motion`) and dims with the banner while the population rebuilds. It wraps correctly across
  the antimeridian. Clicking the place name in the banner scrolls the map into view and flashes the marker.
- **Open in Google Maps:** a link under the place name opens
  `https://www.google.com/maps/search/?api=1&query=LAT,LON` (3 decimals, longitude normalised to −180…180)
  in a new tab (`rel="noopener noreferrer"`). The app itself loads nothing from Google.

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
npm run data:update  # refresh public/data/earthquakes.json from USGS (2018-01-01 → now, M≥4.5)
```

## Algorithm summary

**Prediction target** (for each event *i*, given history `0..i`):

| Head | Target |
|------|--------|
| Time | `log1p(hours until event i+1)` |
| Region | lat/lon of event *i+1* as offset from event *i* |
| Magnitude | magnitude of event *i+1* |

**Features** from recent history (11-D): magnitude, log hours since previous, mean mag of last 5/20, global counts in 7d/30d, counts in the same 30° cell, log hours since last event in that cell, normalized lat/lon, mag anomaly vs last-20 mean.

**Genome:** four linear heads (11 weights + bias each, 48 genes). No tolerance genes — see Fitness. Operators: tournament selection, uniform / single-point crossover, Gaussian-ish mutation, elitism.

**Fitness** (all constants in `src/model/scoring-config.ts`): each walk-forward step is scored per component as
`exp(−|error| / tolerance)` and combined as

    fitness = 0.35 · mean(time) + 0.40 · mean(location) + 0.25 · Σ w·mag / Σ w

over the train window (the first 70% of the filtered timeline, from event 20). Holdout = the later 30%, shown
but never used for selection.

- **Fixed tolerances** — time **1.0** log1p-hour (a factor of e in waiting time), location **300 km** (a large
  aftershock zone / M7–8 rupture length), magnitude **0.5** (a clearly different size class, ≈5.6× energy).
  They used to be evolved genes, and the GA simply widened them to inflate its own score (the magnitude
  tolerance ran to its 2.5 maximum), so they are now fixed a-priori scales, the same for every genome and the baseline.
- **Big-quake weighting** of the magnitude part: `w = min(10, 10^(0.5 · (M − Mmin)))`, where M is the *actual*
  next magnitude and Mmin the slider minimum. Magnitudes follow Gutenberg–Richter (≈10× fewer events per +1 M),
  so an unweighted mean rewards always predicting ≈Mmin; b = 0.5 sits halfway between "every event counts the
  same" (b = 0) and "every magnitude band counts the same" (b = 1), and the cap (reached at Mmin + 2) stops a
  few M8–9 events dominating.

**No-learning baseline** (`src/model/baseline.ts`): next quake at the **same place** as the current one, after the
**median training gap** (median of log1p hours between consecutive training events), with the **median training
magnitude** (all training events are already ≥ the slider minimum). It has no learned parameters beyond those two
training medians and is scored with exactly the same function on train and holdout. The panel under the fitness
chart shows model vs baseline and **skill vs baseline** = (model − baseline) / (1 − baseline): the share of the gap
between the dumb guess and a perfect score that evolution closes (0 = no better, negative = worse).

**Speed:** features and targets do not depend on the genome, so they are computed once per event set and
reused by every genome and generation. Each fitness call scores at most **3,000** walk-forward positions
(`MAX_FITNESS_POINTS`, `src/model/score.ts`); bigger windows use an evenly spaced, deterministic subsample.
At the default M≥5.5 the whole train window (≈2.8k positions) and holdout (≈1.2k) are still scored
exhaustively, so results match the original app; at M≥5.0/M≥4.5 (≈11k/46k train positions) fitness is
estimated on the subsample.

## Minimum-magnitude slider

One threshold drives the whole app: **events with M ≥ the slider value** are the catalog.

| Slider | Value |
|--------|-------|
| Range | `M ≥ 4.5` (the bundled data floor) … `M ≥ 7.5` |
| Step | 0.1 |
| Default | `M ≥ 5.5` (the original catalog, so default behaviour is unchanged) |

Changing it (debounced 250 ms after you stop dragging) filters the catalog, rebuilds the chronological
70/30 train/holdout split, **resets the population** (fitness depends on the event set) and rebuilds the
replay and candidate forecasts. If training was running it restarts on the new set; otherwise press Train.

Lowering it shows more of everything, because the catalog gets denser:

| Threshold | Events | Train / holdout | Walk-forward predictions shown (last 90 days) |
|-----------|-------:|----------------:|----------------------------------------------:|
| M ≥ 7.5 | 40 | 28 / 12 | 3 (minimum) |
| M ≥ 6.5 | 349 | 244 / 105 | 9 |
| M ≥ 6.0 | 1,176 | 823 / 353 | 30 |
| M ≥ 5.5 | 4,065 | 2,845 / 1,220 | 123 |
| M ≥ 5.0 | 15,768 | 11,037 / 4,731 | 573 |
| M ≥ 4.5 | 66,281 | 46,396 / 19,885 | 2,040 |

"Predictions shown" in the UI = those walk-forward predictions (one per M≥threshold event in the last
90 days, each made from the history before it, drawn as yellow squares and stepped through in the replay)
plus the experimental candidate circles. The top-3 candidate panel uses the same threshold: it asks for
each candidate's next predicted **M ≥ threshold** event after today.

## Experimental: top 3 candidates, next M≥(slider) event after today

> **Experimental. Not a real earthquake forecast.** A linear toy model evolved with a genetic
> algorithm cannot predict real earthquakes. This panel shows what the fittest genomes “believe”.

Every generation, the three fittest **distinct** genomes in the population (`topCandidates`,
`src/model/candidates.ts`) each give **one** prediction (`forecastNextBigQuake`, `src/model/forecast.ts`):

1. Predict the next event from the (filtered) catalog. If it is below the slider threshold, append it as if it happened
   and predict again, looking ahead at most **10** predicted events (long chains drift).
2. The first predicted event at or above the threshold is the candidate’s prediction. Its predicted waiting time is
   counted from the **start of tomorrow (UTC)** rather than from the last catalog event — the catalog runs
   up to today, so the quiet time since the last event is treated as memoryless — which means every
   prediction is dated **after today**.
3. If nothing at or above the threshold turns up (or the look-ahead degenerates to a pole / the M9.5 cap), the row says
   so instead of inventing one.

**Consistent:** there is no randomness at forecast time. Results are cached by a hash of the genome’s
genes, so a candidate’s row only changes when the top-3 membership or a genome actually changes. The
reference date (“tomorrow”) is fixed when the page loads or you press Reset.

| Column | Meaning |
|--------|---------|
| Candidate | Rank 1–3 (colour), short genome id, train fitness, generation it entered the top 3 |
| Date (UTC) | Predicted time, plus a ±1 log-hour window (the fixed time tolerance) |
| Location | Region name from the nearest real catalog event’s USGS `place` (offline), lat/lon, and the fixed 300 km location tolerance |
| Mag | Predicted magnitude |
| Score | P(M ≥ threshold) if magnitude errors followed the Laplace kernel the genome is scored with (scale = the fixed 0.5 M tolerance). **Not calibrated.** |

On the map each prediction is a **geodesic circle** (real km, not pixels) centred on the predicted location,
with radius = the fixed 300 km location tolerance, coloured 1/2/3 as in the legend.

Caveat: the evolved magnitude head is weak (it often regresses to the catalog mean or the M4.5 output
floor), so “no prediction” rows are common and expected at any threshold. (Before the slider this panel
used a fixed M>6.0 threshold on the M≥5.5 catalog.)

## Dataset

| Field | Value |
|-------|-------|
| Source | [USGS FDSN event API](https://earthquake.usgs.gov/fdsnws/event/1/) (public catalog) |
| Filters | `minmagnitude=4.5`, `starttime=2018-01-01`, `endtime=2026-09-27T10:59:00`, global |
| Bundled file | `public/data/earthquakes.json` — 66,281 events (2018-01-01 → 2026-09-27), ≈2.1 MB (≈0.8 MB gzipped) |
| Fields kept | time, lat, lon, depth, mag, region (place without the “63 km W of” prefix), sorted by time |

The file uses a compact format (`format: "qv-compact-1"`) so the M≥4.5 catalog stays Pages-friendly:
rows are `[dtSeconds, lat, lon, depthKm, mag, placeIndex]`, where `dtSeconds` is whole seconds since the
previous event (the first row counts from `t0`, epoch ms), lat/lon are rounded to 0.01°, magnitudes keep
two decimals, and `placeIndex` points into a de-duplicated `places` array (−1 = none). `src/data/load.ts`
decodes it; the older plain `{ events: [{ id, time, lat, lon, mag, place }] }` shape still loads. The M≥5.5
subset is the same 4,065 events as the previous snapshot.

Refresh the snapshot (commit the result for Pages):

```bash
npm run data:update                                   # 2018-01-01 → now, M≥4.5
npm run data:update -- --end 2026-09-27T10:59:00      # the bundled snapshot
npm run data:update -- --minmag 5.0                   # smaller file (≈16k events); the slider starts at the floor
```

`scripts/update-earthquakes.mjs` queries the USGS FDSN event service (GeoJSON, `orderby=time-asc`). The
service caps a query at 20,000 events, so it pages by calendar year (M≥4.5 is ≈6.5k–9k events a year) and
splits any page that hits the cap in half. The slider’s minimum follows the file’s `minMag`. The train/holdout split stays chronological 70/30, so holdout covers the
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
