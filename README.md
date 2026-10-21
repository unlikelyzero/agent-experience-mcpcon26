# Agent Experience (AX) evals

Companion repo for the AGNTCon + MCPCon North America 2026 talk and poster
**Agent Experience (AX): accessibility is your agent's interface**.

The same agent does the same task on the same pixels, at three levels of
accessibility. Only the markup changes between them:

| Tier | What it means |
|---|---|
| **Div soup** | No accessible names, no roles, no state. Clickable `<div>`s. |
| **WCAG / Section 508** | Zero axe violations tagged WCAG 2.x A/AA. Compliance. |
| **100% accessibility patterns** | WAI-ARIA APG patterns plus agent hints: contextual names on repeated controls, descriptions, stable ids. |

Every tier renders byte-identical screenshots, so any difference in what the
agent does comes from what it can read, not from what it can see.

## Results so far

From what-iff's Memory Manager: 4 tasks × 3 runs per tier per model, through
Playwright MCP, graded from app state.

| Tokens per successful task | Div soup | WCAG / 508 | 100% patterns |
|---|---|---|---|
| Claude Opus 5.5 | 348k | 301k | 278k |
| Claude Sonnet 5.5 | 402k | 329k | 312k |
| Claude Haiku 4.5 | 2.14M | 1.10M | 922k |
| Claude Haiku 5.5 | 626k | 511k | 626k |
| Success rate, all four models | 90% | 98% | 100% |
| axe WCAG violations | 22 | 0 | 0 |

Div soup costs every model more tokens per success than WCAG: 16% more for
Opus, 22% for Sonnet and Haiku 5.5, and 95% for Haiku 4.5, which also takes
screenshots and falsely claims success there. axe reads zero for both WCAG and
patterns. Patterns went further for Opus, Sonnet and Haiku 4.5 (5–16% fewer
tokens than WCAG) but not for Haiku 5.5. Full tables, per-run data and limits
are in [`results/published/what-iff`](results/published/what-iff/README.md).

## Apps

| App | What it is | Status |
|---|---|---|
| [what-iff](https://github.com/theimaginaryfoundation/what-iff) | AI assistant (Angular, Go) | All three tiers measured with agents. The tiers, seed, graders and runner are on the [`ax-tiers`](https://github.com/neupenguin/what-iff/tree/ax-tiers) branch of a fork. |
| [Headlamp](https://github.com/kubernetes-sigs/headlamp) | Kubernetes UI (React, MUI) | Three tier patches, seed and kubectl graders for H1–H5, pixel gate, axe gate. No agent runs yet. |
| [Open MCT](https://github.com/nasa/openmct) | NASA mission-control UI (Vue) | Pin, build/serve, CouchDB seed and graders for O1–O5, div-soup patch started. |

## Run every app in every tier

Needs Node 22+, git and Docker; Headlamp also needs kind and kubectl. Build the
harness once:

```bash
npm ci && npm run build
alias ax='node dist/harness/src/cli.js'
```

| App | Div soup | WCAG / 508 | 100% patterns |
|---|---|---|---|
| Headlamp | `ax serve --app headlamp --tier div-soup` → http://localhost:4466 | `--tier wcag` → http://localhost:4467 | `--tier patterns` → http://localhost:4468 |
| Open MCT | `ax serve --app openmct --tier div-soup` → http://localhost:8090 | `--tier wcag` → http://localhost:8091 | `--tier patterns` → http://localhost:8092 |
| what-iff | http://localhost:4200/memories?ax=3 | http://localhost:4200/memories?ax=0 | http://localhost:4200/memories?ax=4 |

Open MCT's wcag and patterns tiers have no patch yet, so they serve the app as
shipped.

### Headlamp

```bash
kind create cluster --config apps/headlamp/cluster/kind.yaml
ax prepare --app headlamp            # pinned clone + one worktree per tier
ax seed --app headlamp               # shop-prod and shop-staging fixtures
ax serve --app headlamp --tier wcag  # Ctrl-C stops and removes the container
ax grade --app headlamp --task H1    # after doing the task in the browser
ax eval pixels --app headlamp        # every tier byte-identical, or exit 1
ax eval axe --app headlamp           # WCAG-tagged violations per tier
```

### Open MCT

```bash
ax prepare --app openmct
ax seed --app openmct                # starts CouchDB on :5984 and seeds it
ax serve --app openmct --tier div-soup
ax grade --app openmct --task O1
```

### what-iff

what-iff runs from the [`ax-tiers`](https://github.com/neupenguin/what-iff/tree/ax-tiers)
branch of a fork, where one build serves every tier through `?ax=N`:

```bash
git clone -b ax-tiers https://github.com/neupenguin/what-iff.git && cd what-iff
cp .env.example .env
for v in JWT_SECRET JWT_REFRESH_SECRET TOKEN_ENCRYPTION_SECRET; do echo "$v=$(openssl rand -hex 32)" >> .env; done
echo AUTO_MIGRATE=true >> .env
make db-up && make generate
make run-mock                        # API on :8080 with the mock LLM; leave running
cd web/app && npm ci && npm start    # app on :4200; in a second terminal
```

Then, from `web/app/`:

```bash
# axe, role-based specs and pixel identity, one Playwright project per level
npx playwright test --config e2e/ax-demo/playwright.config.ax-levels.ts \
  --project=axe-ax3 --project=axe-ax0 --project=axe-ax4 \
  --project=functional-ax3 --project=functional-ax0 --project=functional-ax4

# agent runs: tiers as levels 3,0,4; needs a signed-in `claude` CLI
npx tsx e2e/ax-demo/run.ts --levels 3,0,4 --drivers playwright-mcp \
  --tasks T1,T2,T3,T5 --runs 3 --model sonnet --max-budget-usd 1
```

The runner's own README is `web/app/e2e/ax-demo/README.md` on that branch. To
publish a run, merge its CSVs with `apps/what-iff/export-runs.mjs` and
summarize with `apps/what-iff/summarize.mjs`.

## Layout

```
docs/DESIGN.md            design, tiers, tasks, metrics, build order (source of truth)
harness/src/              the `ax` CLI: prepare, diff, patches, serve, seed, grade, eval
apps/<app>/               adapter, fixtures, graders and tiers/<tier>.patch per app
results/published/        the numbers the poster quotes, with per-run CSVs
poster/                   source of the printed poster and its render script
```
