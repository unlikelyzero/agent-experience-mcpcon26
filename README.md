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
| Success rate, all three models | 89% | 97% | 100% |
| axe WCAG violations | 22 | 0 | 0 |

Better markup costs every model fewer tokens. The gap is 20–22% for Opus and
Sonnet, and 57% for Haiku 4.5, which also takes screenshots and falsely claims
success on div soup. axe can't tell WCAG from patterns, but every model spent
fewer tokens on patterns. Full tables, per-run data and limits are in
[`results/published/what-iff`](results/published/what-iff/README.md).

## Apps

| App | What it is | Status |
|---|---|---|
| [what-iff](https://github.com/theimaginaryfoundation/what-iff) | AI assistant (Angular, Go) | All three tiers measured with agents. The tiers, seed, graders and runner are on the [`ax-tiers`](https://github.com/neupenguin/what-iff/tree/ax-tiers) branch of a fork. |
| [Headlamp](https://github.com/kubernetes-sigs/headlamp) | Kubernetes UI (React, MUI) | Three tier patches, seed and kubectl graders for H1–H5, pixel gate, axe gate. No agent runs yet. |
| [Open MCT](https://github.com/nasa/openmct) | NASA mission-control UI (Vue) | Pin, build/serve, CouchDB seed and graders for O1–O5, div-soup patch started. |

## Run it

Needs Node 22+, git, and for Headlamp Docker and kind.

```bash
npm ci && npm run build
node dist/harness/src/cli.js prepare --app headlamp
node dist/harness/src/cli.js serve --app headlamp --tier div-soup
node dist/harness/src/cli.js eval pixels --app headlamp
node dist/harness/src/cli.js eval axe --app headlamp
```

`prepare` clones each app at its pinned commit into `.work/<app>/` with one git
worktree per tier and the tier's patch applied. `ax -h` lists every command.
The what-iff agent runs use the fork branch's own runner; see its
`web/app/e2e/ax-demo/README.md`.

## Layout

```
docs/DESIGN.md            design, tiers, tasks, metrics, build order (source of truth)
harness/src/              the `ax` CLI: prepare, diff, patches, serve, seed, grade, eval
apps/<app>/               adapter, fixtures, graders and tiers/<tier>.patch per app
results/published/        the numbers the poster quotes, with per-run CSVs
```
