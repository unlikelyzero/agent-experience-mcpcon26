# AX evals: design

Companion repo for the AGNTCon + MCPCon North America 2026 talk and poster on
**Agent Experience (AX)**. The claim it measures: **the same agent, doing the
same task, on the same pixels, does worse as an app's accessibility degrades.**

It measures that on two open-source apps, one at a time:

| App | What it is | Stack | Pin |
|---|---|---|---|
| **Headlamp** | Kubernetes UI | React 18 + MUI 5, Go 1.26, Node 22 | `kubernetes-sigs/headlamp` @ `3bb2082a0b30bd32e90c27b06d337f401ca7a596` |
| **what-iff** | AI assistant | Angular 22, Go 1.27 | `theimaginaryfoundation/what-iff` @ `d50ee4f3184cd2560b1a94e6500ae3ab2f17fc3c` |

Results feed the poster's scorecard. Until `results/published/` holds real
runs, the poster's numbers are illustrative and marked as such.

## 1. Layout

```
docs/DESIGN.md            this file; source of truth
harness/src/
  types.ts                AppAdapter, Level, Task, Grade, RunRecord
  cli.ts                  `ax` entry point
  prepare.ts              pinned checkout + one git worktree per level; diff; patch export
  drivers.ts              how the agent reaches the browser (Playwright MCP / CLI)
  stream-metrics.ts       parses `claude -p --output-format stream-json`
apps/<app>/
  app.ts                  the app's AppAdapter
  levels/L<n>-<name>.patch  one plain `git diff` per level, against the level below
  ...                     seed fixtures, graders, cluster config (per app)
.work/<app>/              gitignored; `prepare` output
  src/                    the pinned clone
  L0 … L3/                worktrees on branches ax/L0 … ax/L3
results/
  runs/<run-id>/          gitignored; per-run artifacts (may contain seeded credentials)
  published/              committed; the numbers the poster quotes
```

## 2. Levels

Each level removes one layer of machine-readable semantics **and nothing
visible**. Levels are cumulative: L2 includes L1, L3 includes L2.

| Level | Name | Removed |
|---|---|---|
| L0 | baseline | Nothing. The app at the pin. |
| L1 | no names | Accessible names: `aria-label`, `aria-labelledby`, `<label for>` / wrapping-label associations, `title`-derived names, `alt`. Visible text stays; it is no longer tied to its control. |
| L2 | no roles | Native interactive elements and ARIA roles become plain `<div (click)>`s with no role or `tabindex`: buttons, menu items, tabs, checkboxes, dialog/list/landmark roles. Keyboard access goes with them, as it does in the wild. |
| L3 | no state | State and live regions: `aria-selected`, `aria-expanded`, `aria-checked`, `aria-pressed`, `role=status` / `role=alert`. Key class names get a per-build random suffix so CSS-selector scripts written against one build break on the next. |

Rules for every level patch:

- **Pixel-identical.** Every `evalStates` entry screenshots byte-identical at
  L0 and Ln (`ax eval pixels`, a CI gate). Patches swap elements and
  attributes, and add whatever CSS is needed to make a `<div>` box like the
  `<button>` it replaced; they never change the look.
- **Plain patches.** A level is a `git diff` against the level below, applied
  at build time. No runtime switch in the app. (The earlier what-iff work used
  a runtime `?ax=N` service; that is recut into three patches for this repo.)
- **Scoped.** A patch touches only the components the tasks go through, plus
  shared components they render. List what it touches in the patch's commit
  message in the worktree.

### Headlamp catalog

| Level | Where | Change | Status |
|---|---|---|---|
| L1 | `ActionButton` | Drop `aria-label`; pass the Tooltip `title` as an element, not a string (see Gotchas) | Done |
| L1 | Scale dialog, `ConfirmDialog` | No dialog name or description (`PaperProps` unties MUI's title link); no names on the −/+ Fabs; replica input not labelled by its caption | Done |
| L1 | Delete dialog's Force Delete, Namespaces filter | Wrapping `<label>` becomes a div; `InputLabel` loses `htmlFor` | Done |
| L1 | Table toolbar, row checkboxes | Left named: material-react-table builds those names from its localization strings, which also feed the visible tooltips. No task needs them; rows are reached by their name links, whose names are visible text | Out of scope |
| L2 | `ActionButton` (icon and menu forms), Scale dialog Fabs and buttons, `ConfirmDialog` buttons, delete split-button menu | `<div onClick>` with no role or tab stop: `asDiv` (`frontend/src/lib/ax.ts`) passes `component: 'div'` and `null` role/tabIndex to ButtonBase | Done |
| L2 | Scale dialog, `ConfirmDialog` | Override `role="dialog"` on the Paper via `PaperProps` | Done |
| L2 | Layout `<main>`, sidebar and top bar `<nav>` | Plain divs; no landmarks | Done |
| L2 | Tabs, table row checkboxes, Force Delete checkbox | Not on any task path | Out of scope |
| L3 | Tabs, expandable rows, snackbars | Drop state attrs and live regions; suffix key classes | Not started |

### what-iff catalog

Scope is the Memory Manager (`/memories`) and the `ui-modal` it opens, as in
the earlier runtime work:

| Level | Change |
|---|---|
| L1 | `aria-label`s go (search, filters, "More actions", "Select memory", "Close", "Starred", …). Filter `<label>` wrappers become `<div>`s. |
| L2 | Card ⋮ button and menu items, status tabs, bulk-bar actions, Move menu entries, Move/Delete/Cancel dialog footers become `<div (click)>`. Checkboxes become styled divs toggling a class. `ui-modal` drops `role=dialog`/`aria-modal`/`aria-labelledby`; its close button becomes a div. Cards lose `role=listitem`, the list loses `role=list`. |
| L3 | `aria-selected`, `aria-expanded`, `role=status`, `role=alert` go. Key classes (`memory-card`, `memory-card__menu-btn`, `memory-card__menu`, `memories-shell__tab--active`, …) get a random suffix. |

## 3. Adapter contract

One `AppAdapter` per app (`apps/<app>/app.ts`, type in `harness/src/types.ts`):

| Member | Purpose |
|---|---|
| `name`, `repo`, `sha` | What `prepare` checks out |
| `build(level, dir)` | Build the level's worktree into something servable |
| `serve(level, dir)` | Start it; returns `{ url, stop() }` |
| `seed()` | Put the app in the known starting state for one run; returns what graders need |
| `tasks` | The task list (§4) |
| `evalStates` | Named UI states (`{ name, path, setup? }`) for the pixel, axe and roles evals |

Graders never read the UI the agent was fighting with. Headlamp graders read
the cluster with `kubectl`; what-iff graders read the API as the seeded user.

## 4. Tasks

A run **passes only if the target changed as asked AND every distractor is
unchanged.** Each task has a deliberate distractor a careless agent hits
instead. The agent ends with a line `TASK_COMPLETE` when it believes it is
done; `claimed_done` and `claim_correct` record that claim against the grade.
A false "done" is the most expensive failure in production, so it is counted
separately.

### Headlamp (kind cluster, `apps/headlamp/fixtures.yaml`)

Two namespaces with the same workloads, `shop-prod` and `shop-staging`:
deployments `checkout` and `payments`, a bare `cart` pod that crash-loops, a
`nightly-report` CronJob, and ConfigMaps `feature-flags` and
`feature-flags-old`. Images are `busybox` with different tags per namespace
(prod `payments` is `1.36.1`, staging's is `1.35.0`). Staging is the distractor
for every task.

`seed()` deletes and re-applies both namespaces and snapshots everything
labelled `ax=fixture`. A grader applies its one expected change to the snapshot
and passes only if the live cluster matches it exactly, so any change outside
the target, in prod or staging, fails the run.

| Task | Prompt (abridged) | Grader passes when |
|---|---|---|
| H1 | Scale the `checkout` deployment in `shop-prod` to 3 replicas | prod `checkout` `.spec.replicas == 3`; staging unchanged |
| H2 | Delete the crash-looping `cart` pod in `shop-prod` | that pod UID is gone; staging pods unchanged |
| H3 | Suspend the `nightly-report` CronJob in `shop-prod` | prod `.spec.suspend == true`; staging `false` |
| H4 | Delete the ConfigMap `feature-flags-old` in `shop-prod`, keep `feature-flags` | old gone, new present, staging both present |
| H5 | Report the image tag `payments` runs in `shop-prod` | final answer names the prod tag, not staging's; cluster unchanged |

Each was done by hand in the L0 UI, passed, and failed when done on the
staging copy instead. UI paths: H1 Scale icon → dialog; H2 pod's "More delete
options" → Delete (the trash icon on a pod is Evict); H3 the CronJob's Suspend
button; H4 trash icon → confirm; H5 the deployment's Containers section.

### what-iff (seeded account: 3 personalities, 4 threads, 40 memories)

| Task | Prompt (abridged) | Target | Distractor |
|---|---|---|---|
| W1 | Star the sister memory from the "Lisbon trip" thread | "My sister's name is Priya and she lives in Lisbon" | "My sister's name is Priya" (Home admin, archived) |
| W2 | Change the 9:40 flight to 10:15, keep the rest of the text | "Flight to Lisbon is at 9:40 on Friday" | "Flight to Chicago … at 7:15 on Monday" |
| W3 | Move the seafood-restaurant memory into "Lisbon trip" | "Book dinner at Cervejaria Ramiro …" | other Lisbon-trip memories |
| W4 | Delete every archived old-apartment memory, keep the rest | 3 archived "old apartment" memories | the active deposit-refund one |
| W5 | Archive the gym memory and say when done | "Gym membership renews on the 1st …" | none; `claim_correct` is the signal |

Graders check every seeded memory field by field (content, level, thread,
pinned personality, archived, starred).

## 5. Drivers

| Driver | Package (pinned) | How the agent acts |
|---|---|---|
| `playwright-mcp` | `@playwright/mcp@0.0.83` | The only tool source: `--strict-mcp-config`, built-in tools disabled, headless, isolated |
| `playwright-cli` | `@playwright/cli@0.1.22` | Bash restricted to `playwright-cli` |

Agent invocation: `claude -p <prompt> --output-format stream-json --verbose
--no-chrome --disable-slash-commands --permission-mode dontAsk
--no-session-persistence` plus the driver's args. `ax run` takes
`--max-budget-usd`. Both drivers see the page mainly as Playwright's
accessibility snapshot, which is exactly what the levels strip.

## 6. Metrics

Per run, one `RunRecord` (one CSV row):

| Field | Meaning |
|---|---|
| `pass` | Grader verdict |
| `claimed_done` / `claim_correct` | Agent claimed `TASK_COMPLETE` / the claim matched `pass` |
| `tool_calls` / `browser_tool_calls` / `screenshots` | From the transcript. Screenshots rise when the tree goes quiet |
| `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`, `cost_usd` | From the final `result` event |
| `wall_ms`, `turns`, `exit_code`, `timed_out` | Process facts |
| `fail_reasons` | Grader reasons |

Per level (`ax report`): success rate; mean tool calls and screenshots;
**tokens and $ per successful task** (all spend at that level divided by
passes); false "done" count; **axe violations** over `evalStates`; **roles
pass rate** (the app's own role/label-based specs, unmodified).

axe is reported, never gated: at L2 axe finds fewer violations than at L1
because `<div>`s give it nothing to flag. axe alone understates the damage;
that is a talk point.

## 7. CLI

| Command | Does |
|---|---|
| `ax prepare --app <a> [--force]` | Clone the pin, make `L0–L3` worktrees, apply patches cumulatively; stops with a warning at the first missing patch |
| `ax diff --app <a> <from> <to> [--file <name>]` | Diff two levels' worktrees |
| `ax patches export --app <a>` | Write `apps/<a>/levels/L<n>-<name>.patch` from the committed `ax/L<n-1>..ax/L<n>` diff |
| `ax serve --app <a> --level <n>` | Build and serve one level |
| `ax seed --app <a>` | Reset to the starting state; saves the seed to `.work/<a>/seed.json` |
| `ax grade --app <a> --task <id> [--text <answer>]` | Grade the cluster against the last seed, for checking a task by hand |
| `ax eval pixels --app <a> [--levels 1,2,3]` | Pixel gate: each `evalStates` entry at L0 vs Ln, byte for byte; exits 1 on any difference and writes the pairs to `results/runs/pixels-<time>/` |
| `ax eval axe\|roles --app <a>` | axe and roles reports |
| `ax run --app <a> [--levels] [--drivers] [--tasks] [--runs] [--max-budget-usd]` | The agent matrix. Interleaves levels so drift spreads evenly |
| `ax report --app <a>` | Per-level tables as Markdown and JSON |

Patch workflow: edit and **commit** in `.work/<a>/L<n>`, `ax patches export`,
then `ax prepare --force` so higher levels are rebuilt on the new patch.

## 8. Build order

1. `ax serve` for Headlamp (done): the image build from `npm run image:build`
   tagged `headlamp-ax:L<n>`, run as container `headlamp-ax-L<n>` on kind's
   docker network with `kind get kubeconfig --internal`, published on
   `localhost:4466+n`. Ctrl-C removes the container.
2. Headlamp seed and graders at L0 (done): `kind create cluster --config
   apps/headlamp/cluster/kind.yaml`, `ax seed`, each task by hand, `ax grade`
   passes, and fails on the staging distractor.
3. `ax eval pixels` (done). Headless Chromium from the pinned `playwright`,
   1280×800, UTC, clock frozen so relative ages match. A state is shot when two
   frames 500 ms apart are identical; a differing pair is reshot once, since
   live data (a restart count) can tick between shots. Not in CI yet: it needs
   the kind cluster and Docker builds.
4. Headlamp L1–L3 patches, each passing the pixel gate.
5. `ax eval axe`, `ax eval roles`, then `ax run` and `ax report`.
6. what-iff: port seed and graders, recut the runtime degradations into three
   patches.

## 9. Gotchas

- **MUI Tooltip names buttons.** It copies a string `title` into `aria-label`
  when the child has none, so removing `aria-label` alone does nothing; pass
  the title as an element. MUI `Dialog` puts `role="dialog"` on its Paper;
  override with `PaperProps`.
- **A div opener rings the dialog.** Clicking a native button tells Chromium
  focus came from the mouse; clicking a div does not, so the dialog's
  programmatic focus then matches `:focus-visible` and draws an outline L0
  never shows. L2 suppresses that outline on `ConfirmDialog`'s content.
- **MUI defaults `undefined`.** ButtonBase's `tabIndex` and MenuItem's `role`
  fall back to their defaults when passed `undefined`; pass `null`.
- **Headlamp's classes are already hashed** (emotion `css-…`) at L0, so L3's
  class suffixing matters less there than in what-iff.
- **Headlamp delays its writes.** Scale, delete and suspend show an undo
  snackbar and reach the API server a few seconds later. Grade after that
  window, not the instant the agent clicks.
- **A pod's trash icon is Evict**, not Delete; Delete is under "More delete
  options".
- **`prepare` needs network** to fetch the pinned commit.
- **Headlamp's `image:build` passes `--platform=local`**, which is darwin on a
  Mac and matches no base image. `ax serve` omits it.
- **Headlamp shows `HEADLAMP_SOURCE_COMMIT` in the UI.** Every level's image is
  built with the pin's SHA, not the level's commit, so the pixels match.
- **what-iff's `make check-public-hygiene`** rejects AI attribution in commits.
  That applies only to patches meant for the what-iff repo.
