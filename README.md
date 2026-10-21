<div align="center">

# Agent Experience (AX)

### Accessibility is your agent's interface.

**The same agent, doing the same task, on the same pixels, does better as the markup gets more accessible.**

Companion repo for the AGNTCon + MCPCon North America 2026 poster by [John Hill](https://github.com/unlikelyzero).

[Results](#evals-are-the-outcome) · [Run it](#run-every-app-in-every-tier) · [Design](docs/DESIGN.md) · [Poster source](poster/)

</div>

---

## One UI, four views

Two builds of the same chat box render identical pixels. To an agent they are two very different apps.

> **The task, both builds:** *"Send my message, then confirm it was saved."*

| View | What it is | Size on one real page (1280×800) |
|---|---|---|
| Screenshot | What a human or vision model sees | ≈1.4k tokens · 97 KB PNG |
| DOM | What the browser holds | ≈101k tokens · 404 KB HTML |
| **Accessibility tree** | **What agents read** | **≈13k tokens · 51 KB** |
| Screen reader | Tab order plus live-region announcements | heard, not read |

<table>
<tr>
<th width="50%">❌ Div soup</th>
<th width="50%">✅ WCAG</th>
</tr>
<tr>
<td>

```html
<div class="x9k2">
  <textarea placeholder="Message…">
  <div (click)="send()">
    <svg>…</svg>
  </div>
</div>
<div class="toast">Saved</div>
```

</td>
<td>

```html
<form aria-label="Compose">
  <textarea aria-label="Message">
  <button aria-label="Send message">
    <svg>…</svg>
  </button>
</form>
<div role="status">Saved</div>
```

</td>
</tr>
<tr>
<td>

```yaml
- generic
  - textbox "Message…"
  - generic
    - img
- generic: Saved
```

</td>
<td>

```yaml
- form "Compose":
  - textbox "Message"
  - button "Send message"
- status: Saved
```

</td>
</tr>
<tr>
<td>

**Task fails.** Only the placeholder names the box. Nothing is named *Send*, it can't take focus, and "Saved" is never announced. The only hook is `div.x9k2 > div:nth-child(2)`.

</td>
<td>

**Task passes.** The agent clicks the button named "Send message", and the status live region announces "Saved" on its own. A stable hook: `getByRole('button', { name: 'Send message' })`.

</td>
</tr>
</table>

## Three tiers, same pixels

Each tier is a semantics-only patch on an open-source app. Screenshots are checked byte-identical across tiers, so any difference in what the agent does comes from what it can *read*, not what it can *see*.

| | Tier | Bar |
|---|---|---|
| 🍲 | **Div soup** | No names, no roles, no state. Clickable `<div>`s. |
| ✅ | **WCAG / Section 508** | Zero axe violations tagged WCAG 2.x A/AA. Compliance. |
| 🧭 | **100% accessibility patterns** | WAI-ARIA APG patterns plus agent hints: contextual names on repeated controls, descriptions, stable ids. |

## Evals are the outcome

Each tier is scored two ways: by the evals teams already run, and by an agent doing real tasks.

**Method:** what-iff's Memory Manager, 4 tasks × 3 runs per tier per model, through Playwright MCP. Every run is graded from app state, not the agent's word. Costs are list prices.

| | 🍲 Div soup | ✅ WCAG / 508 | 🧭 Patterns |
|---|:---:|:---:|:---:|
| **Evals you already run** | | | |
| axe WCAG violations | 22 | 0 | 0 |
| Role-based UI tests passing | 5/26 | 26/26 | 26/26 |
| **Agent doing the tasks** · tokens per success<br><sub>$ per success · mean tool calls</sub> | | | |
| Claude Opus 5.5 | 348k<br><sub>$0.29 · 20</sub> | 301k<br><sub>$0.26 · 19</sub> | **278k**<br><sub>$0.28 · 17</sub> |
| Claude Sonnet 5.5 | 402k<br><sub>$0.19 · 19</sub> | 329k<br><sub>$0.16 · 17</sub> | **312k**<br><sub>$0.16 · 16</sub> |
| Claude Haiku 4.5 | 2.14M<br><sub>$0.41 · 37</sub> | 1.10M<br><sub>$0.25 · 27</sub> | **922k**<br><sub>$0.22 · 24</sub> |
| Claude Haiku 5.5 | 626k<br><sub>$0.015 · 24</sub> | **511k**<br><sub>$0.013 · 20</sub> | 626k<br><sub>$0.015 · 24</sub> |
| Success rate, all four models | 90% | 98% | 100% |
| "Done" but wasn't | 2 | 0 | 0 |

> [!IMPORTANT]
> **Watch the axe row.** WCAG and Patterns both read zero, so axe can't tell them apart. Div soup costs every model more tokens than WCAG: 16% more for Opus, 22% for Sonnet and Haiku 5.5, and 95% for Haiku 4.5, which also takes screenshots and falsely claims success there. Patterns went further than compliance for Opus, Sonnet and Haiku 4.5 (5–16% fewer tokens than WCAG), but not for Haiku 5.5.

Per-run data, the T4 exclusion and the other limits are in [`results/published/what-iff`](results/published/what-iff/README.md).

## The takeaway

> **Accessibility is for people first. Agents benefit too.**
>
> The names, roles and state that people who are blind or have low vision rely on, through screen readers and other assistive technology, are the same interface an agent reads. Build it right for people, and agents can use it too.

## The apps

| App | What it is | Status |
|---|---|---|
| [**what-iff**](https://github.com/theimaginaryfoundation/what-iff) | AI assistant · Angular, Go | ✅ All three tiers measured with agents. Tiers, seed, graders and runner live on the [`ax-tiers`](https://github.com/neupenguin/what-iff/tree/ax-tiers) fork branch. |
| [**Headlamp**](https://github.com/kubernetes-sigs/headlamp) | Kubernetes UI · React, MUI | 🔧 Three tier patches, seed and kubectl graders for H1–H5, pixel gate and axe gate. No agent runs yet. |
| [**Open MCT**](https://github.com/nasa/openmct) | NASA mission control · Vue | 🔧 Pin, build and serve, CouchDB seed and graders for O1–O5, div-soup patch started. |

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
