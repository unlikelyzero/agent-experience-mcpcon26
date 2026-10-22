# Headlamp results

[Headlamp](https://github.com/kubernetes-sigs/headlamp) at `3bb2082a`, built from source with each
tier patch in [`apps/headlamp/tiers/`](../../../apps/headlamp/tiers) applied, served against a kind
cluster seeded with two look-alike namespaces, `shop-prod` (the target) and `shop-staging` (the
distractor). Div soup strips names, roles, state and live regions on the task paths, WCAG / Section
508 fixes the one WCAG-tagged axe violation the shipped app has there, and 100% patterns adds APG
dialog patterns and agent hints (hidden `aria-describedby` descriptions, stable ids, `data-testid`).

## Agent runs

Five tasks (H1–H5) × 3 runs per tier per model, driven through `@playwright/mcp@0.0.83` with the
operator's settings, hooks and CLAUDE.md files kept out of the agent's context. Every run reseeds
both namespaces and is graded from the cluster with `kubectl`, not from the agent's claim: it
passes only when the prod target changed as asked and nothing else in either namespace did. Costs
are list prices.

| Task | Prompt (abridged) |
|---|---|
| H1 | Scale `checkout` in `shop-prod` to 3 replicas |
| H2 | Delete the crash-looping `cart` pod in `shop-prod` |
| H3 | Suspend the `nightly-report` CronJob in `shop-prod` |
| H4 | Delete ConfigMap `feature-flags-old` in `shop-prod`, keep `feature-flags` |
| H5 | Report the image tag `payments` runs in `shop-prod`, change nothing |

| Model | Tier | Pass | Mean tool calls | Mean screenshots | Tokens / success | $ / success | False "done" |
|---|---|---|---|---|---|---|---|
| claude-opus-5-5 | div-soup | 15/15 | 13.7 | 0.4 | 212k | $0.19 | 0 |
| claude-opus-5-5 | wcag | 15/15 | 12.1 | 0.1 | 147k | $0.15 | 0 |
| claude-opus-5-5 | patterns | 15/15 | 10.8 | 0.0 | 142k | $0.14 | 0 |
| claude-sonnet-5-5 | div-soup | 14/15 | 13.0 | 1.3 | 246k | $0.13 | 1 |
| claude-sonnet-5-5 | wcag | 15/15 | 11.3 | 0.1 | 159k | $0.090 | 0 |
| claude-sonnet-5-5 | patterns | 15/15 | 10.9 | 0.1 | 163k | $0.089 | 0 |
| claude-haiku-4-5 | div-soup | 14/15 | 22.3 | 0.3 | 1.11M | $0.27 | 1 |
| claude-haiku-4-5 | wcag | 15/15 | 16.1 | 0.1 | 552k | $0.17 | 0 |
| claude-haiku-4-5 | patterns | 15/15 | 22.0 | 1.1 | 833k | $0.20 | 0 |
| claude-haiku-5-5 | div-soup | 15/15 | 21.2 | 3.2 | 492k | $0.013 | 0 |
| claude-haiku-5-5 | wcag | 15/15 | 20.7 | 1.0 | 425k | $0.011 | 0 |
| claude-haiku-5-5 | patterns | 15/15 | 26.4 | 3.7 | 614k | $0.014 | 0 |

| Task | div-soup | wcag | patterns |
|---|---|---|---|
| H1 | 12/12 | 12/12 | 12/12 |
| H2 | 11/12 | 12/12 | 12/12 |
| H3 | 12/12 | 12/12 | 12/12 |
| H4 | 11/12 | 12/12 | 12/12 |
| H5 | 12/12 | 12/12 | 12/12 |

180 runs, $21.55. Regenerate both tables with `ax report --app headlamp --csv
results/published/headlamp/runs.csv`. Every run is a row in [`runs.csv`](runs.csv).

Both failures are div soup and both are false "done" claims: the agent clicked Delete, said the
task was complete, and the delete never reached the cluster (see Limits for why).

## Evals teams already run

| Signal | Div soup | WCAG | Patterns |
|---|---|---|---|
| axe violations tagged WCAG 2.x A/AA over the 8 `evalStates` (nodes) | 2 | 0 | 0 |
| axe best-practice violations (nodes) | 338 | 0 | 0 |
| axe visual violations (nodes) | 0 | 0 | 0 |
| Screenshots identical to div soup, byte for byte (8 states) | — | yes | yes |

Raw output: [`axe.txt`](axe.txt), [`axe.json`](axe.json), [`pixels.txt`](pixels.txt). The app as
shipped has one WCAG violation in these states (the Scale dialog's replica input has no label);
that one fix is the whole `wcag` patch.

Div soup costs every model more tokens per success than WCAG: 44% more for Opus, 54% for Sonnet,
102% for Haiku 4.5 and 16% for Haiku 5.5. Axe reports only 2 WCAG-tagged nodes for div soup,
because a `<div>` with a click handler gives it nothing to flag; nearly all of div soup's axe
findings are best-practice landmark rules. Patterns is level with WCAG for Opus (−4%) and Sonnet
(+2%) and costs the Haiku models more (+51% Haiku 4.5, +44% Haiku 5.5). One H4 run per Haiku
model is an outlier at patterns (49 and 63 tool calls, 3.2M and 1.7M tokens): each agent deleted
the ConfigMap, saw it still listed during Headlamp's undo window, and kept re-checking. Without
those two runs patterns is still above WCAG (+21% and +26%), so the hints don't help the Haiku
models on these tasks.

## Limits

- One app and small samples: 3 runs per task per tier per model. Pass rates are at or near the
  ceiling, so the tiers differ mainly in cost, tool calls and false "done", not in success.
- Headlamp delays every write by 5 seconds behind an undo snackbar, and a run ends when `claude`
  exits, which closes the browser. An agent that declares done inside that window loses the
  write. Both failures are this, at div soup, where the snackbar's `role="alert"` is removed; it
  is counted as a failure, not excluded, since checking the result is part of the task.
- No task was excluded. H5's grader was corrected during the run: it first failed any answer that
  mentioned staging's tag, which wrongly failed one Sonnet 5.5 run (wcag, run 1) that answered
  `1.36.1` and then contrasted staging's `1.35.0`. It now passes when the prod tag is named first,
  and that one row was regraded. Every answer the old rule passed also passes the new one.
- Four runs are not in the table and were rerun: three lost the API mid-run to network outages,
  and one started with the Playwright MCP server reported as failed, so the agent had no browser.
  `ax run` now stops without a row in all three cases.
- The `div-soup` patch covers the task paths only. The table toolbar, row checkboxes and tabs keep
  their names and roles, and class names are not suffixed: Headlamp's own classes are already
  emotion hashes, and suffixing MUI's would break Headlamp's style overrides and the pixels.
- axe scans 8 static states. The snackbars and the delete menu are not among them, so axe's zero
  for WCAG and patterns doesn't cover them. Headlamp's own role/label-based specs have not been
  run against the tiers yet.
- Haiku 5.5 costs are repriced. The `claude` CLI version used (2.1.292) prices Haiku 5.5 at Opus
  5.5 rates, so `ax run` recomputes `cost_usd` for those rows from each request's token counts at
  $0.10/$0.50 per MTok (prompts ≤ 100K tokens) or $0.50/$2.50 (longer), and scales the per-run cap
  so `--max-budget-usd 1` means one real dollar.
