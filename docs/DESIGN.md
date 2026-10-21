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
