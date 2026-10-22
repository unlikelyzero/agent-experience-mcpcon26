# Open MCT results

[NASA Open MCT](https://github.com/nasa/openmct) at `e09bfaf47856b2b7ae2ea74334800b26fd27a41e`
(master, 2026-10-06), built for production and served once per tier from
[`apps/openmct/tiers/`](../../../apps/openmct/tiers). The tiers are div soup (`div-soup.patch`),
WCAG / Section 508 (`wcag.patch`) and 100% patterns (`patterns.patch`). Persistence is a local
CouchDB 3.3.2, reseeded before every run with two folders, `Ops Prod` and `Ops Staging`, that hold
the same objects under the same names. Staging is the distractor in every task. See
`docs/DESIGN.md` §10.

## Agent runs

Five tasks (O1–O5) × 3 runs per tier per model, driven through `@playwright/mcp@0.0.83` with the
operator's settings, hooks and CLAUDE.md files kept out of the agent's context, at a $1 budget per
run. Each run is graded from CouchDB, not from the agent's claim. A run passes only if its target
changed as asked and every other seeded object kept its name, type, location, composition,
configuration, telemetry and notes. Costs are list prices.

| Task | Asks for | Goes through |
|---|---|---|
| O1 | A Display Layout named `Pass 42` in `Ops Prod` | Create menu, create dialog, "Save in" tree |
| O2 | `Battery Temp`'s period set to 20 s | Tree, More actions, Edit Properties form |
| O3 | `Power` moved above `Thermal` in the `Overview` Flexible Layout | Edit mode, frame drag (or Alt+Arrow in patterns), Save menu |
| O4 | `Bus Voltage` renamed to `Bus Voltage (A)` | Tree, More actions, Edit Properties form |
| O5 | `Battery Temp`'s amplitude, reported | Tree, inspector Properties |

| Model | Tier | Pass | Mean tool calls | Mean screenshots | Tokens / success | $ / success | False "done" |
|---|---|---|---|---|---|---|---|
| claude-opus-5-5 | div-soup | 15/15 | 17.3 | 1.5 | 210k | $0.18 | 0 |
| claude-opus-5-5 | wcag | 15/15 | 15.4 | 0.1 | 170k | $0.15 | 0 |
| claude-opus-5-5 | patterns | 15/15 | 14.9 | 0.3 | 171k | $0.15 | 0 |
| claude-sonnet-5-5 | div-soup | 15/15 | 13.7 | 1.6 | 210k | $0.11 | 0 |
| claude-sonnet-5-5 | wcag | 15/15 | 11.7 | 0.0 | 176k | $0.097 | 0 |
| claude-sonnet-5-5 | patterns | 15/15 | 12.8 | 1.3 | 206k | $0.11 | 0 |
| claude-haiku-4-5 | div-soup | 12/15 | 48.7 | 4.0 | 3.31M | $0.54 | 0 |
| claude-haiku-4-5 | wcag | 12/15 | 25.5 | 1.9 | 1.34M | $0.27 | 3 |
| claude-haiku-4-5 | patterns | 13/15 | 34.3 | 4.2 | 1.93M | $0.34 | 0 |
| claude-haiku-5-5 | div-soup | 14/15 | 26.7 | 3.4 | 715k | $0.017 | 0 |
| claude-haiku-5-5 | wcag | 12/15 | 22.0 | 2.9 | 656k | $0.018 | 0 |
| claude-haiku-5-5 | patterns | 14/15 | 21.8 | 2.9 | 561k | $0.014 | 0 |

| Task | div-soup | wcag | patterns |
|---|---|---|---|
| O1 | 12/12 | 12/12 | 12/12 |
| O2 | 12/12 | 12/12 | 12/12 |
| O3 | 9/12 | 6/12 | 9/12 |
| O4 | 11/12 | 12/12 | 12/12 |
| O5 | 12/12 | 12/12 | 12/12 |

180 runs, $26.89 at list prices.

Regenerate the tables with `ax report --app openmct --csv results/published/openmct/runs.csv`.
Every run is a row in [`runs.csv`](runs.csv), a copy of the runner's `results/runs/openmct/runs.csv`.

Without O3, the drag task:

| Model | Div soup | WCAG | Patterns |
|---|---|---|---|
| claude-opus-5-5 | 12/12, 188k / success | 12/12, 159k | 12/12, 157k |
| claude-sonnet-5-5 | 12/12, 159k | 12/12, 129k | 12/12, 127k |
| claude-haiku-4-5 | 11/12, 2.16M | 12/12, 636k | 12/12, 956k |
| claude-haiku-5-5 | 12/12, 556k | 12/12, 369k | 12/12, 403k |

## Evals teams already run

| Signal | Div soup | WCAG | Patterns |
|---|---|---|---|
| axe violation nodes tagged WCAG 2.x A/AA over the nine `evalStates` (shipped Open MCT: 110) | 49 | 0 | 0 |
| axe visual-rule nodes (`color-contrast`), reported, not fixed | 9 | 8 | 8 |
| Screenshots identical across tiers, byte for byte (`ax eval pixels`, 9 states, two runs in a row) | yes | yes | yes |
| Open MCT's own role/label-based e2e specs, unmodified | not run | not run | not run |

## Findings

- **Div soup costs every model more tokens per success than WCAG.** Over all five tasks: Opus
  +24%, Sonnet +19%, Haiku 4.5 +147%, Haiku 5.5 +9%. Without O3: +18%, +23%, +240% and +51%.
  Opus and Sonnet pass everything at every tier, so for them the cost is the only signal. Both
  take screenshots at div soup (1.5 and 1.6 per run) and almost never at WCAG (0.1 and 0.0).
- **axe can't tell WCAG from patterns, and the agents mostly can't either.** Without O3,
  patterns is within 2% of WCAG for Opus and Sonnet, 9% above it for Haiku 5.5, and 50% above it
  for Haiku 4.5.
- **O3 is the hard task, and it is hardest at WCAG.** Opus and Sonnet pass it 9/9. The Haiku
  models pass it 3/6 at div soup, 0/6 at WCAG and 3/6 at patterns. Every O3 failure left the frames
  in their original order. All three false "done"s in the matrix are Haiku 4.5 on O3 at WCAG:
  each claimed the frames had moved. One said it had reordered the inspector's Elements list, a
  confusion Sonnet also hit before recovering. The frames move only by drag in the shipped and
  WCAG builds. Patterns adds Alt+Arrow Up/Down on a
  focused frame, and two runs used it, both passing.
- **One O4 failure.** Haiku 4.5 at div soup left the object named "Bus Voltage (A)Bus Voltage"
  after 99 tool calls, much of it scripted searching for the right element, and told the user to
  restore a backup. It didn't claim done.

## Limits

- One app and small samples: 3 runs per task per tier per model.
- The O3 grader was loosened once, before most of the matrix ran. Reordering the layout's
  composition (the Elements list) no longer fails a run if its members are unchanged; the frame
  order must still be right. The three Sonnet 5.5 rows graded the strict way were dropped and run
  again. No other row grades differently.
- Runs that lost the API mid-run or whose browser server never connected were dropped and run
  again (one row: Haiku 4.5, div soup, O4, run 1).
- The WCAG and patterns tiers rename the compact time conductor's mode button to "Fixed Timespan,
  Time Conductor Mode". Shipped calls it "Time Conductor Mode" while showing "Fixed Timespan",
  which WCAG 2.5.3 forbids, so no WCAG-clean tier can keep that name. Open MCT's e2e specs find it
  by exact name 11 times.
- Div soup keeps native text, number, select and toggle checkbox inputs, and leaves the plot
  controls and header indicators alone; no task uses them.
- `Battery Temp` emits one point per 2.8 hours, so its plot is empty. At 1 Hz the generator's
  worker, which runs on the real clock rather than the eval's frozen page clock, made the pixel
  gate flaky. No task reads the plot.
- Open MCT's own e2e suite was not run against the tiers (`ax eval roles` is not built). DESIGN.md
  §10 predicts it collapses at div soup.
- Haiku 5.5 costs are repriced. The `claude` CLI version used (2.1.292) doesn't know Haiku 5.5's
  prices, so `cost_usd` for those rows is recomputed from each request's token counts by
  `harness/src/pricing.ts` at $0.10/$0.50 per MTok (prompts ≤ 100K tokens) or $0.50/$2.50 (longer).
