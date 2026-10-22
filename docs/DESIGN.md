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
| **Open MCT** | NASA mission-control telemetry UI | Vue 3, webpack, Node >=24.14.1 | `nasa/openmct` @ `e09bfaf47856b2b7ae2ea74334800b26fd27a41e` (master, 2026-10-06) |

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

Scope is the Memory Manager (`/memories`) and the `ui-modal` it opens. The
tiers currently live as levels of a runtime `?ax=N` switch on the
[`ax-tiers`](https://github.com/neupenguin/what-iff/tree/ax-tiers) branch of a
what-iff fork, together with its seed, graders and agent runner. Recutting
them as `tiers/*.patch` is step 7 of the build order.

| Tier | Level | Change |
|---|---|---|
| div-soup | `?ax=3` | `aria-label`s go (search, filters, "More actions", "Select memory", "Close", "Starred", …), and filter `<label>` wrappers become `<div>`s. The card ⋮ button and menu items, status tabs, bulk-bar actions, Move menu entries and dialog footers become `<div (click)>`. Checkboxes become styled divs. `ui-modal` loses `role=dialog`/`aria-modal`/`aria-labelledby`. Cards and the list lose their list roles. `aria-selected`, `aria-expanded`, `role=status` and `role=alert` go. Key classes get a random suffix. |
| wcag | `?ax=0` | The app as shipped. Its only axe findings on these screens are `color-contrast` (visual, reported only) and the best-practice rules `aria-allowed-role` and `heading-order`, so it already has zero WCAG-tagged violations and the patch is empty. |
| patterns | `?ax=4` | Shipped semantics plus agent hints: repeated per-card controls (checkbox, ⋮ button, menu) are named after the memory they act on, the card's name carries its thread and archived/starred state, the menu button gets `aria-haspopup`/`aria-controls`, the editor textarea is named, bulk actions and Move targets get `aria-description`s, and task controls get `data-testid`s. |

Results: [`results/published/what-iff`](../results/published/what-iff/README.md).

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
7. what-iff: tiers, seed, graders and agent runs done on the fork's `ax-tiers`
   branch, and results published. Still to do: port the seed and graders into
   `apps/what-iff`, and recut levels 3 and 4 as `tiers/div-soup.patch` and
   `tiers/patterns.patch`.

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

## 10. Open MCT

NASA's mission-control framework is a Vue 3 single-page app whose features are
all plugins, configured by the repo's `index.html`. That file installs the
example Sine Wave Generator, Display and Flexible Layouts, Tabs, the time
conductor and `LocalStorage` persistence. The pin is in the table at the top;
its `package.json` asks for Node `>=24.14.1`.

### Build and serve

- `build` runs `npm ci` once per worktree, then the production webpack config
  (`npm run build:prod` without the `tsc` types step) into `dist/`.
- `serve` starts CouchDB (see Seed and graders below), then a static server
  inside the `ax` process on `127.0.0.1`:
  - It serves on 8090, 8091 and 8092 for `div-soup`, `wcag` and `patterns`,
    rather than the webpack dev server on 8080, which what-iff's stack holds.
  - It serves the repo's `index.html` at `/`, with `LocalStorage()` rewritten
    to CouchDB, and everything else from `dist/`. The production bundle sets
    `__OPENMCT_ROOT_RELATIVE__` to `""`, so it loads its workers and theme CSS
    from the site root. `/dist/openmct.js` maps to the same folder.
  - Ctrl-C closes the server. CouchDB keeps running for the next serve or
    seed; `docker rm -f openmct-ax-couchdb` removes it.

### Open MCT catalog

Each tier is a patch against the pin, scoped to the surfaces the tasks use:

- the object tree and Recently Viewed
- the browse bar, its More actions menu and its Save menu
- the Create button and menu
- the create and Edit Properties dialogs and their forms
- the inspector's tabs and Properties
- the folder grid view
- Flexible Layout edit mode
- the time conductor, which is on every page

Each tier's commit message in `.work/openmct/<tier>` lists every component it
touches.

**`div-soup`** (`tiers/div-soup.patch`, 46 files)

| Layer | Change |
|---|---|
| Names | `aria-label`, `aria-labelledby`, `title` and `<label for>` go. Visible text stays, so text controls keep their names, while icon buttons, form fields, the tree and the conductor lose theirs |
| Roles | Task-path `<button>`s become `<div class="ax-btn">`: the Create button, browse bar actions, view switcher, overlay close and footer, form OK/Cancel, grid item info, search results, the shell's header, pane and Recently Viewed buttons, and the Snapshot menu button. These roles go: `tree`/`treeitem`, `menu`/`menuitem`/`group`/`separator`, `dialog`, `tablist`/`tab`/`tabpanel`, `grid`/`row`/`gridcell`/`columnheader`, `group`, `switch`, `main`/`region`/`navigation`/`search`, `alert`/`status`. Menu, Save, property, location, breadcrumb and Recently Viewed lists get `role="none"`. `tabindex` and Enter handlers go |
| State | `aria-expanded`, `aria-modal`, `aria-disabled`, `aria-live` and `aria-describedby` go. `aria-disabled` also drew the disabled look, so the create button and menu items use the app's own `.disabled` class instead |
| Look | `_controls.scss` gets `div:is(div):where(.ax-btn)`: Chrome's button defaults plus the app's `button` element rules, at specificity (0,0,2). That beats the app's bare `div { position: relative }` and loses to every class rule, as `button` did |
| Class suffix | A webpack plugin appends one random suffix per build to `c-tree__item`, `c-tree__item-h`, `c-create-button`, `c-menu`, `c-super-menu`, `c-overlay`, `c-fl-frame`, `c-grid-item`, `c-inspector__tab` and `l-browse-bar__actions`. It renames whole class tokens in the emitted JS and CSS alike, and none of these names is built by concatenation |
| Kept | Native text, number, select and toggle checkbox inputs; plot controls and the header indicators, which no task uses |

**`wcag`** (`tiers/wcag.patch`, 17 files). Shipped Open MCT has 110
WCAG-tagged axe violation nodes over the nine `evalStates`; `wcag` has 0.

| Rule | Where | Fix |
|---|---|---|
| `aria-prohibited-attr` | Pane resize handles, conductor axis, Display Layout drop areas | `role="separator"` (dropping the deprecated `aria-grabbed`) and `role="group"`, so the existing labels are legal |
| `aria-required-children` / `-parent` | Folder grid (`gridcell`s with no row); Flexible Layout (`columnheader` straight under `grid`, an `aria-grabbed` resize handle in a `row`) | A `role="row"` wrapper with `display: contents` in the grid view; the Flexible Layout header becomes the row and its size indicator the `columnheader`, keeping "Container Handle n" |
| `label-content-name-mismatch` | Form OK ("Save" vs "Ok"), view switcher, conductor mode/clock/time-system buttons, frames ("Container Frame n") | Names that contain the visible text: "Ok, Save", "Grid View, Open the View Switcher Menu", "Fixed Timespan, Time Conductor Mode"; frame names go |
| `listitem` | Breadcrumb `li`s inside a `ul role="navigation"` | `role="none"` on the items |
| `select-name`, `label` | Plot axis selects; the Notes textarea (`for="form-notes"` vs `id="notes-textarea"`) | `aria-label` |
| `aria-required-attr` | Toggle switches | `aria-checked` |
| `scrollable-region-focusable` | Create menu list | `tabindex="0"` |
| `color-contrast` (visual) | Conductor popup | Reported, not fixed |

**`patterns`** (`tiers/patterns.patch`, 31 files): the `wcag` fixes plus:

| Widget | Pattern |
|---|---|
| Object tree and the dialog's "Save in" tree | APG tree view: `aria-level`, `aria-selected`, the tree hands focus to the selected item, Up/Down/Home/End, Right expands or enters, Left collapses or goes to the parent, Enter/Space opens |
| Create, More actions, view switcher, frame menus | Menu button: `aria-haspopup`, `aria-expanded` tracked through the menu API's `onDestroy`. Menus focus their first item; arrows, Home/End, Enter/Space and Escape/Tab work; focus returns to the opener |
| Browse bar Save | Disclosure: `aria-expanded`/`aria-controls`. Its two options stay `listitem`s, because 95 e2e lookups use that role, and get `tabindex` and Enter/Space |
| Create and Edit Properties overlays | Modal dialog: named by its visible title plus "Modal Overlay" through `aria-labelledby` (a hidden span), so `getByLabel('Modal Overlay')` still matches; Tab is trapped; focus returns to the opener |
| Inspector tabs | Tabs: `aria-selected`, `aria-controls` to the `tabpanel`, roving `tabindex`, Left/Right with automatic activation |
| Flexible Layout frames | In edit mode, frames are focusable and Alt+Up/Down moves a frame: a keyboard alternative to the drag O3 needs |
| Agent hints | `aria-description` on the tree (its keys), each tree item (type and folder path, which tells Ops Prod from Ops Staging), Create, Edit, Save, Cancel, More actions, navigate up, form OK and every menu item. Contextual names on repeated controls ("View menu items for Thermal", "Large View: Thermal", "More Info about X"). Stable ids on tree items and tabs. `data-testid` on tree items, browse bar buttons, menus and items, the dialog, form rows and buttons, inspector tabs and property rows, frames and grid items |

Nothing the e2e specs find by exact name is renamed in `patterns`: the
`Navigate to X` labels, "Save", the "View menu items" title, or "Container
Handle n". The one exception is in both compliant tiers: the compact
conductor's mode button.

All three tiers pass O1–O5 done through the UI. `div-soup` was driven by text
and CSS, `wcag` and `patterns` by roles and names. In `patterns`, 18 scripted
keyboard checks pass, including O3 done with Alt+Up instead of a drag.

### Open MCT tasks (seeded CouchDB: folders `Ops Prod` and `Ops Staging`)

Both folders hold the same objects under the same names:

- Sine Wave Generators `Battery Temp` and `Bus Voltage`
- a Flexible Layout `Overview`, with one container whose two frames are the
  Display Layouts `Thermal` and `Power`, in that order

`Ops Staging` is the distractor for every task, as in Headlamp. Battery
Temp's amplitude is 2.75 in prod and 3.25 in staging, so a read from the
wrong folder gives a different answer. Object keys are fixed:

- `ops-prod`, `p-battery`, `p-bus`, `p-overview`, `p-thermal`, `p-power`
- the `s-` equivalents for staging
- `mine` for My Items

| Task | Prompt (abridged) | Grader passes when |
|---|---|---|
| O1 | Create a Display Layout named `Pass 42` in `Ops Prod` | exactly one new object, a `layout` named `Pass 42`, located in and appended to `ops-prod`'s `composition` |
| O2 | Set the period of `Battery Temp` in `Ops Prod` to 20 seconds | `p-battery.telemetry.period` is 20 (string or number); the other telemetry fields are unchanged |
| O3 | In `Ops Prod`'s `Overview`, move `Power` above `Thermal` and save | `p-overview`'s frames, read in container order, are `p-power`, `p-thermal`; its composition keeps its members, in any order (the Elements list) |
| O4 | Rename `Bus Voltage` in `Ops Prod` to `Bus Voltage (A)` | `p-bus.name` is `Bus Voltage (A)` |
| O5 | Report the amplitude of `Battery Temp` in `Ops Prod` | the final answer contains `2.75` and not `3.25` |

Each grader also checks every seeded object:

- `name`, `type`, `location`, `composition`, `configuration`, `telemetry` and
  `notes` must equal the seed, except the one field the task changes.
- Timestamps are ignored, since saves move them.
- No object may be deleted.
- No new object may appear, except O1's.

Each task has been done through the UI in Chrome against shipped Open MCT.
Every grader passes when the task is done in `Ops Prod`, and fails with the
right reasons when it is done in `Ops Staging`.

Notes on the task choices:

- **O3 is drag-only.** Frames move by HTML5 drag onto drop hints that only
  appear once a drag starts.
- **O5 doesn't use a live value.** "Report the latest value of a telemetry
  point" was dropped: the generator computes values in a web worker from the
  browser's clock, so the right answer moves every second.

### Seed and graders: CouchDB, not localStorage

`index.html` installs `LocalStorage`, which keeps every object as one JSON
blob under the `mct` key of the page's origin. A grader cannot read that,
because the agent's browser profile is isolated and gone when the run ends.
So Open MCT runs on CouchDB, which upstream supports and tests (`@couchdb`
specs):

- **The container.** One `couchdb:3.3.2` container, `openmct-ax-couchdb`, on
  `127.0.0.1:5984`. It uses upstream's compose defaults: admin `admin`, password
  `password`, a throwaway local database.
- **The rewrite.** `serve` replaces `openmct.plugins.LocalStorage()` with
  `CouchDB({ url: 'http://localhost:5984/openmct', useDesignDocuments: true })`
  in the `index.html` response, as upstream's
  `replace-localstorage-with-couchdb-indexhtml.sh` does. The rewrite is
  identical at every tier, so it is in no patch.
- **`seed()`.** It deletes the `openmct` database and runs upstream's
  `setup-couchdb.sh`, read from the pin with `git show`. That script recreates
  the database, makes `_security` public and adds the design documents.
  `seed()` then bulk-loads the fixture as `{ _id, metadata, model }`
  documents, upstream's `CouchDocument` shape.
- **Graders.** They read `_all_docs?include_docs=true` and compare each
  document's `.model` with the seed.

### Roles suite: Open MCT's own Playwright e2e

`e2e/` is a large suite that already leans on accessible names, so it can run
unmodified as the roles signal. Across 92 `*.e2e.spec.js` files it uses:

| Locator | Count |
|---|---|
| `getByRole` | about 976 |
| `getByLabel` | about 1366 |
| `getByText` | 172 |
| `getByTitle` | 48 |
| `getByTestId` | none |
| `page.locator` CSS selectors | about 620 |

About 75% of the semantic locators depend on a name. The most used are:

- listitem "Save and Finish Editing"
- button "Save"
- treeitem
- tab "Config"
- button "Create"
- button "Ok"
- searchbox "Search Input"
- button "Edit Object"
- menuitem "Edit Properties…"
- button "Time Conductor Mode"

State assertions are rare: `aria-selected` 4, `expanded: true` 2,
`toBeChecked` 8.

**Expected shape across tiers** (not run yet; `ax eval roles` is not built):

- **`div-soup` collapses it.** `createDomainObjectWithDefaults` in
  `e2e/appActions.js`, which nearly every spec calls, fills the form with
  `getByLabel('Title')`. That name comes from `<label for>`, which
  `div-soup` removes. The time conductor helpers, `expandEntireTree` and
  `renameCurrentObjectFromBrowseBar` also rely on names.
- **`wcag` should almost match shipped.** The form OK button is "Ok, Save",
  so the substring lookups `getByRole('button', { name: 'Save' })` and
  `getByLabel('Save')` still find it. Only the 11 lookups of the compact
  conductor's mode button by exact name "Time Conductor Mode" stop matching.
  Shipped breaks WCAG 2.5.3 there, so no WCAG-clean tier can keep that name.
- **`patterns`** is `wcag` plus hints the suite doesn't query. It keeps
  every exact name and `getByLabel('Modal Overlay')`, so it should match
  `wcag`.

Shortlist for the roles suite. These are functional specs, with no
`@couchdb`, `@snapshot`, `@generatedata`, mobile or perf:

| Spec (`e2e/tests/functional/…`) | Tests | Leans on |
|---|---|---|
| `tree.e2e.spec.js` | 8 | tree, treeitem, "Expand" labels |
| `forms.e2e.spec.js` | 11 | textbox, checkbox, field labels |
| `ui/inspector.e2e.spec.js` | 2 | tabs "Properties"/"Styles", button "Inspect" |
| `moveAndLinkObjects.e2e.spec.js` | 3 | treeitem, menuitem, CSS |
| `recentObjects.e2e.spec.js` | 7 | getByRole incl. `expanded: true` |
| `renaming.e2e.spec.js` | 1 | browse bar labels |
| `smoke.e2e.spec.js` | 2 | almost no names; a sanity check |
| `plugins/timeConductor/timeConductor.e2e.spec.js` | 8 | conductor labels |
| `plugins/displayLayout/displayLayout.e2e.spec.js` | 17 | tab "Elements", labels |
| `plugins/flexibleLayout/flexibleLayout.e2e.spec.js` | 8 | dialog, CSS |
| `plugins/tabs/tabs.e2e.spec.js` | 3 | labels, checkbox |
| `search.e2e.spec.js` | 9 | searchbox, dialog, status |

Running it against a tier, unchanged:

- **baseURL.** Every config hardcodes `baseURL: 'http://localhost:8080/'` and
  a `webServer` of `npm run start:coverage`, and nothing reads an env var. Use
  a wrapper config outside the app's tree: it imports
  `e2e/playwright-ci.config.js`, overrides `use.baseURL` to the tier's port
  and drops `webServer`. The specs and fixtures stay untouched.
- **Persistence.** The shortlist assumes `LocalStorage` persistence, so the
  roles run needs `serve` without the CouchDB rewrite. That is a flag still to
  add.
- **`/test-data`.** The dev server also mounts `e2e/test-data` at
  `/test-data`. Only framework, mobile, perf and visual specs use it, so it is
  left out.
- **Fixtures.** `baseFixtures.js` collects coverage only when
  `window.__coverage__` exists, so the uninstrumented production build is
  fine. It fails tests on any console error (`failOnConsoleError`), so a tier
  must load without 404s.
- **axe.** `tests/visual-a11y` has 12 `@a11y` specs that call axe (`wcag2aa`)
  through `scanForA11yViolations` in `e2e/avpFixtures.js`. They are a
  ready-made source for `ax eval axe`.

### Open MCT gotchas

- **Names from content survive name stripping.** Tree items, menu items, the
  Create button and text buttons are named by their visible text, so
  `div-soup` hurts them through their roles, not their names.
- **`:disabled="false"` on a div is an attribute.** Vue renders it as
  `disabled="false"`, and the app's `*[disabled]` rule then dims the element
  and blocks clicks on it. `div-soup` binds `disabled` as `x || null`. The
  create-dialog `evalState` caught this.
- **`aria-disabled` is styling.** `[aria-disabled='true']` dims controls, so
  removing the state changes pixels; `div-soup` uses the app's `.disabled`
  class instead.
- **`title` drives a cursor.** `inspector.scss` and `_legacy.scss` set
  `cursor: help` on `[title]` cells. Screenshots don't capture the cursor, so
  removing `title` keeps the pixel gate.
- **`evalStates` setup selectors** avoid the `button` tag and the classes
  `div-soup` suffixes (`.c-create-button--w > *`, `.l-browse-bar .icon-3-dots`,
  `li:text-is(...)`), so they work at every tier.
- **Open MCT never goes network-idle.** The CouchDB changes feed holds a
  request open; `ax eval` waits for idle for 5 s at most and relies on its
  settle loop.
- **Live telemetry defeats a frozen page clock.** The generator runs in a
  worker on the real clock. A 1 Hz plot drew a new segment at its right edge
  between shots, a 1–16 px flake. So the fixture's Battery Temp emits one
  point per 2.8 h, and its states use a fixed past window. The table view is
  no better: its Wavelength column is random.
- **The production bundle loads assets from the site root**, not `dist/`; see
  Build and serve.
- **The built-in browser pane has no `SharedWorker`.** Open MCT's CouchDB
  changes feed runs in one, so the pane shows "Attempting to connect to
  CouchDB…" forever. Reads and writes still work. Chrome shows "CouchDB is
  connected".
- **Upstream's `AGENTS.md` asks for an `Assisted-by:` trailer.** That is for
  contributions to `nasa/openmct`; tier commits in `.work/` are local and
  don't carry it.
