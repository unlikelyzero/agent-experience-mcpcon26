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
| div-soup | `ActionButton` | Drop `aria-label`; pass the Tooltip `title` as an element, not a string (see Gotchas) | Patch started (`tiers/div-soup.patch`) |
| div-soup | Table toolbar / search, resource links, dialog form fields | Drop names and label associations | Not started |
| div-soup | `ActionButton`, menus, tabs, table row checkboxes | `<div onClick>`; no role | Not started |
| div-soup | MUI `Dialog` | Override `role="dialog"` on the Paper via `PaperProps` | Not started |
| div-soup | Tabs, expandable rows, snackbars | Drop state attrs and live regions | Not started |
| wcag | Task surfaces | Fix what the axe WCAG scan of shipped finds | Needs the shipped scan |
| patterns | Task surfaces | APG audit per widget, plus agent hints | Not started |

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
| `ax eval pixels\|axe\|roles --app <a>` | Pixel gate; axe and roles reports |
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
2. Headlamp seed and graders: `kind create cluster --config
   apps/headlamp/cluster/kind.yaml`, `adapter.seed()`, do each task by hand,
   confirm each grader passes, and fails on the staging distractor.
3. `ax eval pixels`, as a CI gate.
4. `ax eval axe` with WCAG tag filtering. It defines when the `wcag` tier is
   done.
5. Headlamp tier patches, each passing the pixel gate: `div-soup`, `wcag`
   (axe-clean), `patterns` (APG audit plus hints).
6. `ax eval roles`, then `ax run` and `ax report`.
7. what-iff: port seed and graders, recut runtime level 3 as `div-soup`, write
   `wcag` and `patterns`.

## 9. Gotchas

- **MUI Tooltip names buttons.** It copies a string `title` into `aria-label`
  when the child has none, so removing `aria-label` alone does nothing; pass
  the title as an element. MUI `Dialog` puts `role="dialog"` on its Paper;
  override with `PaperProps`.
- **Headlamp's classes are already hashed** (emotion `css-…`), so div soup's
  class suffixing matters less there than in what-iff.
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

Each tier is a patch against the pin and scoped to the surfaces the tasks use:

- the object tree
- the browse bar, its More actions menu and its Save menu
- the Create button and menu
- the create and Edit Properties dialogs and their forms
- the inspector's Properties tab
- Flexible Layout edit mode
- the time conductor, which is on every page

**`div-soup`**

| Where | Change | Status |
|---|---|---|
| Object tree (`MctTree`, `ObjectLabel`, `ViewControl`), browse bar (`BrowseBar`, `ViewSwitcher`), Create button, menus (`MenuComponent`, `SuperMenu`), dialogs and forms (`OverlayComponent`, `FormProperties`, `FormRow`, `NumberField`, `SelectField`), inspector (`InspectorTabs`, `ObjectName`, `DetailText`, `ElementItem`), Tabs view, Flexible Layout (`ContainerComponent`, `FrameComponent`), time conductor (`ConductorComponent`, `ConductorInputsFixed`, `ConductorInputsRealtime`, `ConductorMode`, `TimePopupFixed`) | Drop `aria-label`, `aria-labelledby`, `title` and `<label for>`. Visible text is kept, so text controls keep their names, and icon buttons, form fields, the tree and the conductor lose theirs | Done (`tiers/div-soup.patch`); `DatePicker` not yet |
| Browse bar, form footer and conductor popup `<button>`s | `<div @click>` styled like `.c-button`; no `tabindex` | Not started |
| `TreeItem`, `MctTree`, `ViewControl`, `ConductorMode` | Drop `role="tree"`, `treeitem`, `button` and `aria-expanded`. These are already `<div>`s | Not started |
| Menus | Drop `role="menu"`, `menuitem`, `group` and `separator`, plus `aria-live` on the description | Not started |
| `OverlayComponent` | Drop `role="dialog"` and `aria-modal` | Not started |
| `InspectorTabs`, `TabsComponent` | Drop `role="tablist"`, `tab` and `tabindex`. Neither sets `aria-selected`; the current tab is shown only by the `is-current` class | Not started |
| `NumberField`, `ToggleSwitch`, `CheckBoxField` | Native inputs and `role="switch"` become styled divs | Not started |
| `NotificationBanner` | Drop `role="alert"` and `aria-live` | Not started |
| `c-tree__item`, `c-create-button`, `l-browse-bar__actions`, `c-overlay`, `c-fl-frame`, `c-menu`, `is-current` | Per-build class suffix | Not started |

The names-only `div-soup` patch screenshots byte-identical to shipped in six
states with the page clock frozen:

- home
- create menu
- create dialog
- a new Sine Wave Generator's plot
- More actions
- the conductor popup

With it applied, `getByLabel('Title')`, the "Main Tree" tree, "More actions"
and the "Period" spinbutton no longer resolve. "Create" still does, because
its visible text names it.

**`wcag`: the shipped scan.** axe-core 4.14 ran with the five WCAG tags over
nine states on a seeded database:

- `evalStates` (prod folder, Battery Temp, Overview, Overview in edit mode,
  create menu, More actions, conductor popup)
- the create dialog
- Edit Properties

Shipped Open MCT is not compliant. Ten rules fail; two of them are visual and
are reported only. That makes `wcag.patch` real work.

| Rule | Impact | Where | Fix in `wcag` |
|---|---|---|---|
| `aria-prohibited-attr` | serious | Pane resize handles ("Resize Browse Pane", …), `.c-conductor-axis`, Flexible Layout frames ("Thermal Layout") | Give the handles `role="separator"`; drop or move the names on role-less divs |
| `aria-required-children` | critical | Folder grid view (`GridView`: `role="grid"` with no rows), `.c-fl-container` and its frames holder | Folder: `role="list"`/`listitem`. Flexible Layout: drop the grid/row/gridcell roles it misuses |
| `aria-required-parent` | critical | Grid view items, `.c-fl-container__header` (`columnheader`) | Follows from the fix above |
| `label-content-name-mismatch` | serious | Form OK button (name "Save", text "Ok"), conductor mode/clock/time-system buttons, view switcher, Flexible Layout frames | Names that start with the visible text |
| `listitem` | serious | Location breadcrumbs (`.c-location__item`) in the inspector and Recently Viewed | Wrap the items in a list |
| `select-name` | critical | Plot axis label `<select>`s | `aria-label` |
| `label` | critical | Notes textarea: the row's `<label for="form-notes">` misses `id="notes-textarea"` | Match the id |
| `aria-required-attr` | critical | Edit Properties toggles (`ToggleSwitch`, `role="switch"` without `aria-checked`) | `aria-checked` |
| `scrollable-region-focusable` | serious | Create menu list (`.c-super-menu__menu`) | `tabindex="0"` |
| `target-size` | serious, visual | Small icon buttons (pane collapse, sync tree, new window, frame menus, ⋯) | Reported, not fixed |
| `color-contrast` | serious, visual | Conductor popup labels and inputs | Reported, not fixed |

`label-content-name-mismatch` is an axe "experimental" rule tagged
`wcag21a`; it ran with the tag filter. Decide whether the gate counts it.

**`patterns`: APG audit of the task widgets**

| Widget | APG pattern | Shipped gaps to close |
|---|---|---|
| Object tree | Tree View | `aria-level`/`setsize`/`posinset`, roving `tabindex`, arrow-key and typeahead navigation, `aria-selected` on the navigated item. The name comes from an inner link |
| Create, More actions, Save, conductor mode | Menu Button + Menu | `aria-haspopup="menu"`, `aria-expanded`, `aria-controls` on the buttons; arrow keys and Escape in the menu; Save's options are `<li>`s with no menu role |
| Create and Edit Properties overlays | Dialog (Modal) | `aria-labelledby` to the dialog title instead of "Modal Overlay"; focus trap; Escape; focus back to the opener |
| Inspector tabs | Tabs | `aria-selected`, `aria-controls`, a `tabpanel`, arrow keys |
| Form toggles | Switch | `aria-checked` (also a `wcag` fix) |
| Number fields | Spinbutton (native) | Labelled by the row label, not a duplicate `aria-label` |
| Flexible Layout reorder | None; drag only | WCAG 2.2 SC 2.5.7 (Dragging Movements, AA) needs a single-pointer alternative, and axe can't detect its absence. A visible Move up/down control changes the pixels; a menu entry only changes the open-menu state. Open question |
| Agent hints | — | `aria-describedby` on Create, Edit, Save, More actions and the menu items saying what each does; stable `id`s; `data-testid` on the tree items, the form fields and the frames |

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
| O3 | In `Ops Prod`'s `Overview`, move `Power` above `Thermal` and save | `p-overview`'s frames, read in container order, are `p-power`, `p-thermal` |
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

**Expected shape across tiers:**

- **`div-soup` collapses it.** `createDomainObjectWithDefaults` in
  `e2e/appActions.js`, which nearly every spec calls, fills the form with
  `getByLabel('Title')`. That name comes from `<label for>`. The time
  conductor helpers, `expandEntireTree` and
  `renameCurrentObjectFromBrowseBar` also rely on names. The names-only patch
  alone already breaks all of them.
- **`wcag` should match shipped.** It adds semantics without renaming
  anything the suite queries. Two exceptions:
  - The form's OK button is named "Save" today, and specs click
    `getByRole('button', { name: 'Save' })`. A `label-content-name-mismatch`
    fix that renames it to "Ok…" would break them, so the `wcag` fix must keep
    "Save" in the name ("Ok, save").
  - The same holds for any renamed conductor button.
- **`patterns`** adds `data-testid`, which the suite doesn't use, so it should
  also match shipped.

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
  `div-soup`'s names step only hurts controls named by
  `aria-label`/`title`/`label for`. Their roles go in the roles step.
- **`title` drives a cursor.** `inspector.scss` and `_legacy.scss` set
  `cursor: help` on `[title]` cells. Screenshots don't capture the cursor, so
  removing `title` keeps the pixel gate.
- **`evalStates` setup selectors use classes that `div-soup` suffixes**
  (`.c-create-button`, `.l-browse-bar__actions`). The pixel gate has to
  resolve them before the suffix applies, or match on a prefix.
- **The production bundle loads assets from the site root**, not `dist/`; see
  Build and serve.
- **The built-in browser pane has no `SharedWorker`.** Open MCT's CouchDB
  changes feed runs in one, so the pane shows "Attempting to connect to
  CouchDB…" forever. Reads and writes still work. Chrome shows "CouchDB is
  connected".
- **Upstream's `AGENTS.md` asks for an `Assisted-by:` trailer.** That is for
  contributions to `nasa/openmct`; tier commits in `.work/` are local and
  don't carry it.
- **Freeze time for screenshots.** The header clock, conductor bounds and
  plots move every second. `page.clock.setFixedTime` freezes the page but not
  the generator's worker. Plots of an unseeded generator matched anyway in
  the shipped vs. names-only check; don't rely on that for `ax eval pixels`.
