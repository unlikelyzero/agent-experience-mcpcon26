# AX evals: design

Companion repo for the AGNTCon + MCPCon North America 2026 talk and poster on
**Agent Experience (AX)**. The claim it measures: **the same agent, doing the
same task, on the same pixels, does worse as an app's accessibility degrades.**

It measures that on two open-source apps, one at a time:

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
| L1 | `ActionButton` | Drop `aria-label`; pass the Tooltip `title` as an element, not a string (see Gotchas) | Not yet rebuilt |
| L1 | Table toolbar / search, resource links, form fields in dialogs | Drop names and label associations | Not started |
| L2 | `ActionButton`, menus, tabs, table row checkboxes | `<div onClick>`; no role | Not started |
| L2 | MUI `Dialog` | Override `role="dialog"` on the Paper via `PaperProps` | Not started |
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

Two namespaces with the same workloads, `shop-prod` and `shop-staging`.
Staging is the distractor for every task.

| Task | Prompt (abridged) | Grader passes when |
|---|---|---|
| H1 | Scale the `checkout` deployment in `shop-prod` to 3 replicas | prod `checkout` `.spec.replicas == 3`; staging unchanged |
| H2 | Delete the crash-looping `cart` pod in `shop-prod` | that pod UID is gone; staging pods unchanged |
| H3 | Suspend the `nightly-report` CronJob in `shop-prod` | prod `.spec.suspend == true`; staging `false` |
| H4 | Delete the ConfigMap `feature-flags-old` in `shop-prod`, keep `feature-flags` | old gone, new present, staging both present |
| H5 | Report the image tag `payments` runs in `shop-prod` | final answer names the prod tag, not staging's; cluster unchanged |

These are drafts until step 2 of the build order confirms each one by hand in
the UI.

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
| `ax eval pixels\|axe\|roles --app <a>` | Pixel gate; axe and roles reports |
| `ax run --app <a> [--levels] [--drivers] [--tasks] [--runs] [--max-budget-usd]` | The agent matrix. Interleaves levels so drift spreads evenly |
| `ax report --app <a>` | Per-level tables as Markdown and JSON |

Patch workflow: edit and **commit** in `.work/<a>/L<n>`, `ax patches export`,
then `ax prepare --force` so higher levels are rebuilt on the new patch.

## 8. Build order

1. `ax serve` for Headlamp (done): the image build from `npm run image:build`
   tagged `headlamp-ax:L<n>`, run as container `headlamp-ax-L<n>` on kind's
   docker network with `kind get kubeconfig --internal`, published on
   `localhost:4466+n`. Ctrl-C removes the container.
2. Headlamp seed and graders at L0: `kind create cluster --config
   apps/headlamp/cluster/kind.yaml`, `adapter.seed()`, do each task by hand,
   confirm each grader passes, and fails on the staging distractor.
3. `ax eval pixels`, as a CI gate.
4. Headlamp L1–L3 patches, each passing the pixel gate.
5. `ax eval axe`, `ax eval roles`, then `ax run` and `ax report`.
6. what-iff: port seed and graders, recut the runtime degradations into three
   patches.

## 9. Gotchas

- **MUI Tooltip names buttons.** It copies a string `title` into `aria-label`
  when the child has none, so removing `aria-label` alone does nothing; pass
  the title as an element. MUI `Dialog` puts `role="dialog"` on its Paper;
  override with `PaperProps`.
- **Headlamp's classes are already hashed** (emotion `css-…`) at L0, so L3's
  class suffixing matters less there than in what-iff.
- **`prepare` needs network** to fetch the pinned commit.
- **Headlamp's `image:build` passes `--platform=local`**, which is darwin on a
  Mac and matches no base image. `ax serve` omits it.
- **Headlamp shows `HEADLAMP_SOURCE_COMMIT` in the UI.** Every level's image is
  built with the pin's SHA, not the level's commit, so the pixels match.
- **what-iff's `make check-public-hygiene`** rejects AI attribution in commits.
  That applies only to patches meant for the what-iff repo.

## 10. Open MCT

NASA's mission-control framework: a Vue 3 single-page app whose features are
all plugins, configured by the repo's `index.html` (it installs the example
Sine Wave Generator, Display and Flexible Layouts, Tabs, the time conductor
and `LocalStorage` persistence). Pin in the table at the top; the pin's
`package.json` asks for Node `>=24.14.1`.

### Build and serve

- `build` runs `npm ci` once per worktree, then the production webpack config
  (`npm run build:prod` without the `tsc` types step) into `dist/`.
- `serve` is a static server inside the `ax` process on
  `127.0.0.1:8090+n`, not the webpack dev server on 8080 (what-iff's stack
  holds 8080). It serves the repo's `index.html` at `/` and everything else
  from `dist/`: the prod bundle sets `__OPENMCT_ROOT_RELATIVE__` to `""`, so
  it loads its workers (`generatorWorker.js`, `inMemorySearchWorker.js`) and
  theme CSS from the site root. `/dist/openmct.js` maps to the same folder.
  Ctrl-C closes the server.

### Open MCT catalog

| Level | Where | Change | Status |
|---|---|---|---|
| L1 | Object tree: `MctTree`, `ObjectLabel`, `ViewControl` | Drop the tree's "Main Tree" name, each label's "Navigate to X folder Object", the expand toggles' names, status-indicator titles | Done |
| L1 | Browse bar: `BrowseBar`, `ViewSwitcher` | Drop names and titles on Navigate up, object name, view switcher, lock, Edit, Save, Cancel Editing, More actions. All are icon buttons, so they end up nameless | Done |
| L1 | Create button and menus: `CreateButton`, `MenuComponent`, `SuperMenu` | Drop `aria-labelledby`, menu `aria-label`s and item titles. "Create" and menu items keep the name of their visible text | Done |
| L1 | Dialogs and forms: `OverlayComponent`, `FormProperties`, `FormRow`, `NumberField`, `SelectField` | Drop "Modal Overlay", the Close/Save/Cancel names, `<label for>` and the controls' `aria-label`s. The OK button's name falls back from "Save" to its text "Ok" | Done |
| L1 | Inspector: `InspectorTabs`, `ObjectName`, `DetailText`, `ElementItem` | Drop tab titles, the "X inspector properties" row names, "X Element Item" | Done |
| L1 | Tabs view (`TabsComponent`), Flexible Layout (`ContainerComponent`, `FrameComponent`) | Drop "X tab", "Container Handle n", "Container Frame n" and the frame names | Done |
| L1 | Time conductor: `ConductorComponent`, `ConductorInputsFixed`, `ConductorInputsRealtime`, `ConductorMode`, `TimePopupFixed` | Drop "Start bounds: …", "Time Conductor Mode", "Start time", "Submit time bounds" and the rest | Done; `DatePicker` ("Start date") not yet |
| L2 | Tree items, `ViewControl`, `ConductorMode` | `role="treeitem"`/`role="tree"`/`role="button"` go; already `<div>`s, so only the attribute changes | Not started |
| L2 | Browse bar, form footer, conductor popup `<button>`s | `<div @click>` styled like `.c-button` | Not started |
| L2 | Menus | `role="menu"`/`menuitem`/`group`/`separator` go | Not started |
| L2 | `OverlayComponent` | `role="dialog"` and `aria-modal` go | Not started |
| L2 | `InspectorTabs`, `TabsComponent` | Both are `<div role="tab">`; `role="tablist"`/`tab` and `tabindex` go | Not started |
| L2 | Form controls: `NumberField`, `ToggleSwitchField`, `CheckBoxField` | Native inputs become styled divs | Not started |
| L3 | `TreeItem`, `ViewControl` | `aria-expanded` goes | Not started |
| L3 | `InspectorTabs`, `TabsComponent` | Nothing to drop: neither sets `aria-selected`; the current tab is only the `is-current` class (suffixed below). The Tabs view's "- selected" lived in its name and went at L1 | Not started |
| L3 | `NotificationBanner`, `SuperMenu` description, `ClockComponent` | `role="alert"` and `aria-live` go | Not started |
| L3 | `c-tree__item`, `c-create-button`, `l-browse-bar__actions`, `c-overlay`, `c-fl-frame`, `is-current` | Per-build class suffix | Not started |

The L1 patch is byte-identical to L0 in six states (home, create menu, create
dialog, a new Sine Wave Generator's plot, the More actions menu, the conductor
popup), screenshotted with Playwright and `page.clock.setFixedTime`. That is
the start of `evalStates`. At L1, `getByLabel('Title')`, the "Main Tree" tree,
"More actions" and the "Period" spinbutton no longer resolve; "Create" does.

### Open MCT tasks (seeded CouchDB: folders `Ops Prod` and `Ops Staging`)

Both folders hold the same objects under the same names: Sine Wave Generators
`Battery Temp` and `Bus Voltage`, a Flexible Layout `Overview` with frames
`Thermal` and `Power`, a Telemetry Table `Events`. `Ops Staging` is the
distractor for every task, as in Headlamp. Its generators get different
periods and amplitudes so a read from the wrong folder gives a different
answer.

| Task | Prompt (abridged) | Grader passes when |
|---|---|---|
| O1 | Create a Display Layout named `Pass 42` in `Ops Prod` | exactly one new `layout` object named `Pass 42`, in `Ops Prod`'s `composition`; `Ops Staging` and `My Items` compositions unchanged |
| O2 | Set the period of `Battery Temp` in `Ops Prod` to 20 seconds | prod object `.telemetry.period == 20`; every other field and the staging copy unchanged |
| O3 | In `Ops Prod`'s `Overview`, move `Power` before `Thermal` | prod `configuration.containers[0].frames` order is Power, Thermal; staging unchanged |
| O4 | Rename `Bus Voltage` in `Ops Prod` to `Bus Voltage (A)` | prod `.name` changed; staging `Bus Voltage` unchanged; no object added or removed |
| O5 | Report the amplitude of `Battery Temp` in `Ops Prod` | final answer names the prod amplitude, not staging's; database unchanged |

O1 goes through the create menu and the create dialog's "Save in" tree; O2
and O4 through the tree, browse bar More actions → Edit Properties… and the
form; O3 through Edit, Flexible Layout frame drag and Save; O5 through the
tree and the inspector's Properties tab. The time conductor is on every page
and is in the catalog for that reason. No task needs it yet.

"Report the latest value of a telemetry point" was considered for O5 and
dropped: the Sine Wave Generator computes values in a web worker from the
browser's clock, so the right answer moves every second and a grader would
need a tolerance window.

These are drafts until each is done by hand at L0 against the seed.

### Seed and graders: CouchDB, not localStorage

`index.html` installs `LocalStorage`, which keeps every object as one JSON
blob under the `mct` key of the page's origin. A grader cannot read that: the
agent's browser profile is isolated and gone when the run ends. So Open MCT
runs on CouchDB, which upstream supports and tests (`@couchdb` specs):

- One `couchdb:3.3.2` container on `127.0.0.1:5984`, from upstream's
  `src/plugins/persistence/couch/couchdb-compose.yaml`; CORS and the
  `openmct` database set up as `setup-couchdb.sh` does.
- `serve` rewrites the `LocalStorage()` line of `index.html` at response
  time, as upstream's `replace-localstorage-with-couchdb-indexhtml.sh` does
  (`CouchDB({url: "http://localhost:5984/openmct", useDesignDocuments: true})`).
  The rewrite is identical at every level, so it is not part of any patch
  and does not affect the pixel gate.
- `seed()` deletes and recreates the `openmct` database and PUTs one
  document per object: `{ _id: key, model: <domain object> }`. That includes
  the root `mine` folder ("My Items") with the two folders in its
  `composition`.
- Graders `GET /openmct/<key>` and compare `.model` field by field, plus
  `_all_docs` to catch objects added or removed. Object keys come from the
  seed. O1 finds the new layout through the prod folder's `composition`.

Not implemented yet: `seed()`, the graders, and the `index.html` rewrite in
`serve`.

### Roles suite: Open MCT's own Playwright e2e

`e2e/` is a large suite that already leans on accessible names, so it can run
unmodified as the roles signal. Across 92 `*.e2e.spec.js` files there are
about 976 `getByRole`, 1366 `getByLabel`, 48 `getByTitle`, 172 `getByText`,
no `getByTestId`, and about 620 `page.locator` CSS selectors. About 75% of
the semantic locators depend on a name. The most used are listitem "Save and
Finish Editing", button "Save", treeitem, tab "Config", button "Create",
button "Ok", searchbox "Search Input", button "Edit Object", menuitem "Edit
Properties…" and button "Time Conductor Mode". State assertions (L3) are rare:
`aria-selected` 4, `expanded: true` 2, `toBeChecked` 8.

**It collapses at L1, not across L1–L3.** `createDomainObjectWithDefaults`
in `e2e/appActions.js`, which nearly every spec calls, fills the form with
`getByLabel('Title')`. That name comes from `<label for>`, which L1 removes.
The time conductor helpers, `expandEntireTree` and
`renameCurrentObjectFromBrowseBar` also use names. So a per-test pass rate
reads roughly 100% / near 0 / 0 / 0 across L0–L3. To get a gradient, report
it per spec file *and* per locator kind, or run a second pass with only the
setup helper's form fields kept named. Decide which when `ax eval roles` is
built.

Shortlist for the roles suite (functional, no `@couchdb`, `@snapshot`,
`@generatedata`, mobile or perf):

| Spec (`e2e/tests/functional/…`) | Tests | Leans on |
|---|---|---|
| `tree.e2e.spec.js` | 8 | tree, treeitem, "Expand" labels |
| `forms.e2e.spec.js` | 11 | textbox, checkbox, field labels |
| `ui/inspector.e2e.spec.js` | 2 | tabs "Properties"/"Styles", button "Inspect" |
| `moveAndLinkObjects.e2e.spec.js` | 3 | treeitem, menuitem, CSS |
| `recentObjects.e2e.spec.js` | 7 | getByRole incl. `expanded: true` |
| `renaming.e2e.spec.js` | 1 | browse bar labels |
| `smoke.e2e.spec.js` | 2 | almost no names; L0 sanity check |
| `plugins/timeConductor/timeConductor.e2e.spec.js` | 8 | conductor labels |
| `plugins/displayLayout/displayLayout.e2e.spec.js` | 17 | tab "Elements", labels |
| `plugins/flexibleLayout/flexibleLayout.e2e.spec.js` | 8 | dialog, CSS |
| `plugins/tabs/tabs.e2e.spec.js` | 3 | labels, checkbox |
| `search.e2e.spec.js` | 9 | searchbox, dialog, status |

Running it against a level, unchanged:

- Every config hardcodes `baseURL: 'http://localhost:8080/'` and a
  `webServer` of `npm run start:coverage`; nothing reads an env var. Use a
  wrapper config outside the app's tree that imports
  `e2e/playwright-ci.config.js` and overrides `use.baseURL` to
  `localhost:8090+n` and drops `webServer`. The specs and fixtures stay
  untouched.
- The shortlist runs on the plain `LocalStorage` build, not CouchDB.
- The dev server also mounts `e2e/test-data` at `/test-data`. Only
  framework, mobile, perf and visual specs use it, so it is left out.
- `baseFixtures.js` collects coverage only when `window.__coverage__`
  exists, so the uninstrumented prod build is fine. It fails tests on any
  console error (`failOnConsoleError`), so a level must load without 404s.
- `tests/visual-a11y` has 12 `@a11y` specs that call axe (`wcag2aa`) through
  `scanForA11yViolations` in `e2e/avpFixtures.js`. They are a ready-made
  source for `ax eval axe` on Open MCT.

### Open MCT gotchas

- **Names from content survive L1.** Tree items, menu items, the Create
  button and text buttons are named by their visible text. L1 only
  hurts controls whose name lived in `aria-label`/`title`/`label for`: icon
  buttons, form fields, the conductor, the tree itself.
- **`title` drives a cursor.** `inspector.scss` and `_legacy.scss` set
  `cursor: help` on `[title]` cells. Screenshots don't capture the cursor,
  so removing `title` keeps the pixel gate.
- **The prod bundle loads assets from the site root**, not `dist/`; see
  Build and serve.
- **Upstream's `AGENTS.md` asks for an `Assisted-by:` trailer.** That is for
  contributions to `nasa/openmct`; level commits in `.work/` are local and
  don't carry it.
- **Freeze time for screenshots.** The header clock, conductor bounds and
  plots move every second; `page.clock.setFixedTime` freezes the page, but
  not the generator's worker. Plots of an unseeded generator matched anyway
  in the L0/L1 check. Don't rely on that for `ax eval pixels`.
