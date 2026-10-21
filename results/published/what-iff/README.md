# what-iff results

The Memory Manager (`/memories`) of [what-iff](https://github.com/theimaginaryfoundation/what-iff)
at the pinned commit, with the tiers served from the
[`ax-tiers`](https://github.com/neupenguin/what-iff/tree/ax-tiers) branch: div soup is `?ax=3`,
WCAG / Section 508 is `?ax=0` (the app as shipped), and 100% patterns is `?ax=4`. The real Go API ran
in mock-LLM mode.

## Agent runs

Four tasks (T1–T3, T5) × 3 runs per tier per model, driven through `@playwright/mcp@0.0.83` with
the operator's settings, hooks and CLAUDE.md files kept out of the agent's context. Each run is
graded from app state through the API, not from the agent's claim. Costs are list prices.

| Model | Tier | Pass | Mean tool calls | Mean screenshots | Tokens / success | $ / success | False "done" |
|---|---|---|---|---|---|---|---|
| claude-opus-5-5 | div-soup | 12/12 | 20.2 | 0.3 | 348k | $0.29 | 0 |
| claude-opus-5-5 | wcag | 12/12 | 19.3 | 0.0 | 301k | $0.26 | 0 |
| claude-opus-5-5 | patterns | 12/12 | 16.9 | 0.0 | 278k | $0.28 | 0 |
| claude-sonnet-5-5 | div-soup | 11/12 | 19.1 | 0.3 | 402k | $0.19 | 0 |
| claude-sonnet-5-5 | wcag | 12/12 | 17.3 | 0.0 | 329k | $0.16 | 0 |
| claude-sonnet-5-5 | patterns | 12/12 | 15.8 | 0.0 | 312k | $0.16 | 0 |
| claude-haiku-4-5 | div-soup | 9/12 | 37.3 | 1.6 | 2.14M | $0.41 | 2 |
| claude-haiku-4-5 | wcag | 11/12 | 26.7 | 0.0 | 1.10M | $0.25 | 0 |
| claude-haiku-4-5 | patterns | 12/12 | 24.4 | 0.2 | 922k | $0.22 | 0 |
| claude-haiku-5-5 | div-soup | 11/12 | 24.3 | 0.1 | 626k | $0.015 | 0 |
| claude-haiku-5-5 | wcag | 12/12 | 20.3 | 0.0 | 511k | $0.013 | 0 |
| claude-haiku-5-5 | patterns | 12/12 | 23.8 | 0.4 | 626k | $0.015 | 0 |

Regenerate with `node apps/what-iff/summarize.mjs`. Every run is a row in [`runs.csv`](runs.csv), built
from the runner's CSVs by `apps/what-iff/export-runs.mjs`, which also reprices Haiku 5.5.

## Evals teams already run

| Signal | Div soup | WCAG | Patterns |
|---|---|---|---|
| axe violations tagged WCAG 2.x A/AA (list, Move menu, Move-to-thread dialog) | 22 | 0 | 0 |
| what-iff's own role/label-based memory specs, unmodified | 5/26 | 26/26 | 26/26 |
| Screenshots identical to WCAG, byte for byte | yes | — | yes |

Div soup costs every model more tokens per success than WCAG: 16% more for Opus, 22% for Sonnet
and Haiku 5.5, and 95% for Haiku 4.5. Both compliant tiers read zero on axe, so axe can't tell them
apart; the agents mostly can. Patterns cost 5–16% fewer tokens than WCAG for Opus, Sonnet and
Haiku 4.5, but not for Haiku 5.5, where patterns came out level with div soup and above WCAG. One
Haiku 5.5 patterns run (T3, 47 tool calls, 1.58M tokens) is an outlier; without it patterns is
still about 5% above WCAG, so the hints don't help Haiku 5.5 on these tasks.

## Limits

- One app and small samples: 3 runs per task per tier per model.
- T4 ("delete every archived old-apartment memory") is excluded. It failed in all 9 Opus runs at
  every tier because one target is scoped to a thread and never appears in the Archived view, so it
  measures discoverability, not accessibility. It needs rework before it is used again.
- The shipped editor textarea has no label. axe doesn't scan the editing state, so the WCAG tier's
  zero doesn't cover it.
- One what-iff spec ("deep-links directly to the Archived status tab") is flaky at both WCAG and
  patterns.
- Haiku 5.5 costs are repriced. The `claude` CLI version used (2.1.292) doesn't know Haiku 5.5's
  prices and reports Opus 5.5 rates, so `cost_usd` for those rows is recomputed from each request's
  token counts at $0.10/$0.50 per MTok (prompts ≤ 100K tokens) or $0.50/$2.50 (longer), with
  cache reads at 0.1× and 1-hour cache writes at 2× the input rate. The same method reproduces the
  CLI's figures for Sonnet 5.5 and Haiku 4.5 to the cent.
