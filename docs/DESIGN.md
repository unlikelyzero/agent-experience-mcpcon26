# AX evals: design

Companion repo for the AGNTCon + MCPCon North America 2026 talk and poster on
**Agent Experience (AX)**. The claim it measures: **the same agent, doing the
same task, on the same pixels, does better as an app's accessibility goes from
div soup, to WCAG / Section 508 compliant, to full accessibility patterns.**

It measures that on open-source apps, one at a time:

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
  types.ts                AppAdapter, Tier, Task, Grade, RunRecord
  cli.ts                  `ax` entry point
  prepare.ts              pinned checkout + one git worktree per tier; diff; patch export
  exec.ts                 shell and HTTP-wait helpers
  drivers.ts              how the agent reaches the browser (Playwright MCP / CLI)
  stream-metrics.ts       parses `claude -p --output-format stream-json`
apps/<app>/
  app.ts                  the app's AppAdapter
  tiers/<tier>.patch      one plain `git diff` per tier, against the pin
  ...                     seed fixtures, graders, cluster config (per app)
.work/<app>/              gitignored; `prepare` output
  src/                    the pinned clone
  div-soup/ wcag/ patterns/   worktrees on branches ax/<tier>
results/
  runs/<run-id>/          gitignored; per-run artifacts (may contain seeded credentials)
  published/              committed; the numbers the poster quotes
```

## 2. Tiers

Three tiers. Each is a patch on the app as shipped, and each changes
**machine-readable semantics only**: markup, roles, names, states and ARIA.
The app as shipped is the starting point for the patches, not a measured
column.

| Tier | Id | Bar |
|---|---|---|
| **Div soup** | `div-soup` | Everything a task touches is a `<div>`. No accessible names (`aria-label`, label associations, `title`-derived names, `alt`). No roles: buttons, menu items, tabs, checkboxes, dialogs, lists and landmarks become `<div onClick>` with no role or `tabindex`, so keyboard access goes too. No state (`aria-selected`, `aria-expanded`, `aria-checked`, `aria-pressed`, live regions). Key class names get a per-build random suffix, so CSS-selector scripts written against one build break on the next. |
| **WCAG / Section 508** | `wcag` | Zero axe violations tagged `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` or `wcag22aa` over every `evalStates` entry. Section 508 incorporates WCAG 2.0 AA, so this bar covers it. Visual rules (`color-contrast`, `link-in-text-block`, `target-size`) are reported, not fixed: fixing them would change the pixels. This is compliance, the bar most teams ship to. |
| **100% accessibility patterns** | `patterns` | The `wcag` bar, plus every widget the tasks touch follows its WAI-ARIA Authoring Practices (APG) pattern: roles, names, states, the keyboard model, landmarks and live regions. On top of that come **agent hints**: an `aria-describedby` description of what each action does, stable `id`s, and `data-testid` on task-relevant controls. This tier tests whether going beyond compliance helps agents. |

Rules for every tier patch:

- **Pixel-identical.** Every `evalStates` entry screenshots byte-identical
  across all three tiers (`ax eval pixels`, a CI gate). Patches swap elements
  and attributes, and add whatever CSS is needed to make a `<div>` box like the
  `<button>` it replaced; they never change the look.
- **Plain patches, independent.** A tier is a `git diff` against the pin,
  applied at build time. Tiers are not cumulative: `div-soup` removes
  semantics the shipped app has, while `wcag` and `patterns` add them. No
  runtime switch in the app. (The earlier what-iff work used a runtime
  `?ax=N` service; that is recut into tier patches here.)
- **An empty patch is a result.** If the shipped app already meets the `wcag`
  bar on the task surfaces, `wcag.patch` is empty and the report says so.
- **Scoped.** A patch touches only the components the tasks go through, plus
  shared components they render. List what it touches in the commit message
  in the tier's worktree.

### Headlamp catalog

| Tier | Where | Change | Status |
|---|---|---|---|
| div-soup | `ActionButton` | Drop `aria-label`; pass the Tooltip `title` as an element, not a string (see Gotchas) | Done |
| div-soup | Scale dialog, `ConfirmDialog` | No dialog name or description (`PaperProps` unties MUI's title link); no names on the −/+ Fabs; replica input not labelled by its caption | Done |
| div-soup | Delete dialog's Force Delete, Namespaces filter | Wrapping `<label>` becomes a div; `InputLabel` loses `htmlFor` | Done |
| div-soup | `ActionButton` (icon and menu forms), Scale dialog Fabs and buttons, `ConfirmDialog` buttons, delete split-button menu | `<div onClick>` with no role or tab stop: `asDiv` (`frontend/src/lib/ax.ts`) passes `component: 'div'` and `null` role/tabIndex to ButtonBase | Done |
| div-soup | Scale dialog, `ConfirmDialog` | Override `role="dialog"` on the Paper via `PaperProps` | Done |
| div-soup | Layout `<main>`, sidebar and top bar `<nav>` | Plain divs; no landmarks | Done |
| div-soup | Snackbars, copy-button and table status regions, details sections, delete split button | No `role="alert"` (notistack hardcodes it; a ref strips it), no `role="status"`/`aria-live`/`aria-busy`, no `aria-haspopup`/`aria-expanded`/`aria-controls` | Done |
| div-soup | Table toolbar, row checkboxes, tabs, Force Delete checkbox | Left as shipped. No task path needs them, and material-react-table builds its toolbar names from the strings that feed the visible tooltips | Out of scope |
| div-soup | Class-name suffix | Not done: Headlamp's own classes are emotion hashes already, and suffixing MUI's would break Headlamp's `.Mui*` style overrides and so the pixels | Out of scope |
| wcag | Scale dialog replica input | The shipped scan of the 8 `evalStates` finds one WCAG violation, `label`: MUI's `Input` puts `aria-labelledby` on its wrapper div, so the `<input>` has no label. Moved onto `inputProps`. No visual or best-practice findings | Done: WCAG-clean |
| patterns | Scale dialog | The wcag fix; APG modal dialog (`aria-modal`, labelled by its title, described by the current count); stable ids and `data-testid`s on the dialog, input, −/+ and Cancel/Apply | Done |
| patterns | `ConfirmDialog` | APG alert dialog: `role="alertdialog"`, `aria-modal`; `data-testid` | Done |
| patterns | `ActionButton`, delete split button, CronJob Suspend/Resume | `hint` (`aria-describedby` to a `hidden` element, never drawn) and `testId` props. Hints say what each action does; Evict's says how it differs from Delete, the H2 trap | Done |
| patterns | Delete split button menu, landmarks, tables | Already follow their patterns as shipped (menu button with `aria-haspopup`/`aria-expanded`/`aria-controls`, named `nav` and `main`, native tables) | No change |

### what-iff catalog

Scope is the Memory Manager (`/memories`) and the `ui-modal` it opens.

| Tier | Change |
|---|---|
| div-soup | The earlier runtime level 3, recut as a patch. `aria-label`s go (search, filters, "More actions", "Select memory", "Close", "Starred", …), and filter `<label>` wrappers become `<div>`s. The card ⋮ button and menu items, status tabs, bulk-bar actions, Move menu entries and dialog footers become `<div (click)>`. Checkboxes become styled divs. `ui-modal` loses `role=dialog`/`aria-modal`/`aria-labelledby`. Cards and the list lose their list roles. `aria-selected`, `aria-expanded`, `role=status` and `role=alert` go. Key classes get a random suffix. |
| wcag | Fix the WCAG-tagged axe findings on shipped. The shipped scan found `color-contrast` (visual, so reported only), plus `aria-allowed-role` and `heading-order`, which are best-practice rules rather than WCAG ones. So this patch may be empty; confirm with a tag-filtered scan. |
| patterns | APG audit of the card menu (menu button pattern), the status tabs (tabs), the bulk "Select all" (checkbox), the Move dialog (modal dialog) and the list (listbox or grid), plus agent hints. |

The earlier runtime results (memory specs passing 26/26 shipped, falling to
5/26 at runtime level 3) were measured on the old level scale. Level 3 is
roughly `div-soup`; re-run on the tier patches before quoting.

## 3. Adapter contract

One `AppAdapter` per app (`apps/<app>/app.ts`, type in `harness/src/types.ts`):

| Member | Purpose |
|---|---|
| `name`, `repo`, `sha` | What `prepare` checks out |
| `build(tier, dir)` | Build the tier's worktree into something servable |
| `serve(tier, dir)` | Start it; returns `{ url, stop() }` |
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

Each was done by hand in the shipped UI, passed, and failed when done on the
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
--no-chrome --disable-slash-commands --setting-sources '' --permission-mode
dontAsk --no-session-persistence` plus the driver's args, run in an empty
temp directory. `--setting-sources ''` and the temp directory keep the
operator's hooks, plugins and CLAUDE.md files out of the agent's context.
`ax run` takes `--max-budget-usd`. Both drivers see the page mainly as
Playwright's accessibility snapshot, which is exactly what the tiers change.

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

Per tier (`ax report`): success rate; mean tool calls and screenshots;
**tokens and $ per successful task** (all spend at that tier divided by
passes); false "done" count; **axe violations** over `evalStates`, split into
WCAG-tagged, visual and best-practice; **roles pass rate** (the app's own
role/label-based specs, unmodified).

axe is reported, never gated, except as the definition of the `wcag` tier. Div
soup can show fewer axe violations than a half-labelled app, because `<div>`s
give axe nothing to flag. axe alone understates the damage; that is a talk
point. The `patterns` tier versus the `wcag` tier is the other talk point:
whether compliance is enough for agents.

## 7. CLI

| Command | Does |
|---|---|
| `ax prepare --app <a> [--force]` | Clone the pin and make one worktree per tier, each with its patch applied. A tier with no patch yet is left as an unpatched copy, ready to edit |
| `ax diff --app <a> <from> <to> [--file <name>]` | Diff two tiers, or `shipped` against a tier |
| `ax patches export --app <a>` | Write `apps/<a>/tiers/<tier>.patch` from each tier's committed diff against the pin |
| `ax serve --app <a> --tier <t>` | Build and serve one tier |
| `ax seed --app <a>` | Reset to the starting state; saves the seed to `.work/<a>/seed.json` |
| `ax grade --app <a> --task <id> [--text <answer>]` | Grade the cluster against the last seed, for checking a task by hand |
| `ax eval pixels --app <a> [--tiers a,b,…]` | Pixel gate: each `evalStates` entry in every tier vs the first, byte for byte (default: every prepared tier; an unpatched tier is the app as shipped); exits 1 on any difference and writes the pairs to `results/runs/pixels-<time>/` |
| `ax eval axe --app <a> [--tiers a,b,…]` | axe-core on every `evalStates` entry per tier, split into WCAG-tagged, visual and best-practice; exits 1 unless `wcag` and `patterns` have no WCAG violations. Findings go to `results/runs/axe-<time>/axe.json` |
| `ax eval roles --app <a>` | Roles report |
| `ax run --app <a> [--tiers] [--drivers] [--tasks] [--runs] [--max-budget-usd]` | The agent matrix. Interleaves tiers so drift spreads evenly |
| `ax report --app <a>` | Per-tier tables as Markdown and JSON |

Patch workflow: edit and **commit** in `.work/<a>/<tier>`, then run
`ax patches export`. Tiers are independent, so editing one never invalidates
another.

## 8. Build order

1. `ax serve` for Headlamp (done): the image build from `npm run image:build`
   tagged `headlamp-ax:<tier>`, run as container `headlamp-ax-<tier>` on kind's
   docker network with `kind get kubeconfig --internal`, published on
   `localhost:4466` (div-soup), `4467` (wcag) and `4468` (patterns). Ctrl-C
   removes the container.
2. Headlamp seed and graders (done): `kind create cluster --config
   apps/headlamp/cluster/kind.yaml`, `ax seed`, each task by hand on the
   shipped app, `ax grade` passes, and fails on the staging distractor.
3. `ax eval pixels` (done). Headless Chromium from the pinned `playwright`,
   1280×800, UTC, clock frozen so relative ages match. A state is shot when two
   frames 500 ms apart are identical; a differing pair is reshot once, since
   live data (a restart count) can tick between shots. Not in CI yet: it needs
   the kind cluster and Docker builds.
4. `ax eval axe` with WCAG tag filtering (done). It defines when the `wcag`
   tier is done. It runs every rule axe enables by default and sorts the
   results; a rule counts as WCAG when it carries one of the five tags.
5. Headlamp tier patches, each passing the pixel gate: `div-soup` (done for
   the task paths), `wcag` (done, axe-clean), `patterns` (done for the task
   paths: APG dialog patterns plus hints). All three pixel-identical.
6. `ax eval roles`, then `ax run` and `ax report`.
7. what-iff: port seed and graders, recut runtime level 3 as `div-soup`, write
   `wcag` and `patterns`.

## 9. Gotchas

- **MUI Tooltip names buttons.** It copies a string `title` into `aria-label`
  when the child has none, so removing `aria-label` alone does nothing; pass
  the title as an element. MUI `Dialog` puts `role="dialog"` on its Paper;
  override with `PaperProps`.
- **A div opener rings the dialog.** Clicking a native button tells Chromium
  focus came from the mouse; clicking a div does not, so the dialog's
  programmatic focus then matches `:focus-visible` and draws an outline the
  shipped app never shows. div-soup suppresses that outline on
  `ConfirmDialog`'s content.
- **MUI defaults `undefined`.** ButtonBase's `tabIndex` and MenuItem's `role`
  fall back to their defaults when passed `undefined`; pass `null`.
- **Headlamp's classes are already hashed** (emotion `css-…`), so div soup's
  class suffixing matters less there than in what-iff.
- **Headlamp delays its writes.** Scale, delete and suspend show an undo
  snackbar and reach the API server a few seconds later. Grade after that
  window, not the instant the agent clicks.
- **A pod's trash icon is Evict**, not Delete; Delete is under "More delete
  options".
- **`prepare` needs network** to fetch the pinned commit.
- **Headlamp's `image:build` passes `--platform=local`**, which is darwin on a
  Mac and matches no base image. `ax serve` omits it.
- **Headlamp shows `HEADLAMP_SOURCE_COMMIT` in the UI.** Every tier's image is
  built with the pin's SHA, not the tier's commit, so the pixels match.
- **what-iff's `make check-public-hygiene`** rejects AI attribution in commits.
  That applies only to patches meant for the what-iff repo.
