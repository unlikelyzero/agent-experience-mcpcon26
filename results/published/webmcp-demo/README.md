# webmcp-demo results

[`sdras/webmcp-demo`](https://github.com/sdras/webmcp-demo) at `45ddb9060b08fba6ce2a14f4240f77beaf404608`
(main, 2026-07-19) is Sarah Drasner's one-page WebMCP explainer. It shows the same booking widget
twice, side by side: a "Without WebMCP" panel, which a scripted agent scrapes, and a "With WebMCP"
panel, which the page's three WebMCP tools (`getAvailability`, `bookSlot`, `cancelBooking`) drive.
It is a static page with no build. Each tier patch in
[`apps/webmcp-demo/tiers/`](../../../apps/webmcp-demo/tiers) is applied to it, and it is served
once per tier:

- **Div soup** strips names, roles, state and landmarks from both widgets and the run bar.
- **WCAG / Section 508** fixes the one WCAG-tagged axe rule and exposes the selected day and time.
- **100% patterns** adds the APG date-picker grid and radio group, names the two widgets apart,
  and adds descriptions and `data-testid`s.

The WebMCP tool code is byte-identical to shipped in every tier, so the tiers differ only in
markup. See `docs/DESIGN.md` §11.

## Agent runs

There are five tasks (M1–M5), run 3 times per tier per model. Each run is driven through
`@playwright/mcp@0.0.83`, with the operator's settings, hooks and CLAUDE.md files kept out of the
agent's context, at a $1 budget per run.

The app keeps bookings only in page memory. So `ax serve` injects a test hook, the same in every
tier, that does two things:

- It pins the page's "today" to 2026-11-02.
- It logs every confirmed booking to the server: widget, day, time, name, email and id.

A run passes only if exactly the expected booking was made, once, in the named widget, and no
other booking was made in either widget. Costs are list prices.

| Task | Asks for | Distractor |
|---|---|---|
| M1 | Book Thu Nov 12, 10:00 AM in the **With WebMCP** widget | The identical Without widget |
| M2 | Book Thu Dec 3, 3:00 PM in the **Without WebMCP** widget | Nov 3, the preselected day under the same day number, where 3 PM is also open |
| M3 | List the bookable times on Fri Nov 20, book nothing | 11 AM and 4 PM, drawn but disabled |
| M4 | Book Wed Nov 25, 2:00 PM in the **With WebMCP** widget and report the confirmation ID | `BK-AB12CD`, the example id shown in the Registered tools panel |
| M5 | Book Wed Nov 18, 11:00 AM in the **Without WebMCP** widget, or the earliest later time | The disabled 11 AM slot (the answer is 2 PM) |

| Model | Tier | Pass | Mean tool calls | Mean screenshots | Tokens / success | $ / success | False "done" |
|---|---|---|---|---|---|---|---|
| claude-opus-5-5 | div-soup | 15/15 | 8.7 | 0.0 | 134k | $0.18 | 0 |
| claude-opus-5-5 | wcag | 15/15 | 9.5 | 0.1 | 152k | $0.20 | 0 |
| claude-opus-5-5 | patterns | 15/15 | 9.3 | 0.0 | 139k | $0.18 | 0 |
| claude-sonnet-5-5 | div-soup | 15/15 | 9.3 | 0.1 | 140k | $0.099 | 0 |
| claude-sonnet-5-5 | wcag | 15/15 | 8.1 | 0.2 | 126k | $0.092 | 0 |
| claude-sonnet-5-5 | patterns | 15/15 | 8.3 | 0.0 | 147k | $0.11 | 0 |
| claude-haiku-4-5 | div-soup | 15/15 | 18.8 | 3.5 | 815k | $0.19 | 0 |
| claude-haiku-4-5 | wcag | 15/15 | 13.7 | 1.6 | 442k | $0.14 | 0 |
| claude-haiku-4-5 | patterns | 15/15 | 14.1 | 0.9 | 503k | $0.15 | 0 |
| claude-haiku-5-5 | div-soup | 15/15 | 10.1 | 0.3 | 240k | $0.009 | 0 |
| claude-haiku-5-5 | wcag | 14/15 | 9.3 | 0.0 | 219k | $0.008 | 1 |
| claude-haiku-5-5 | patterns | 15/15 | 9.3 | 0.0 | 198k | $0.008 | 0 |

| Task | div-soup | wcag | patterns |
|---|---|---|---|
| M1 | 12/12 | 12/12 | 12/12 |
| M2 | 12/12 | 11/12 | 12/12 |
| M3 | 12/12 | 12/12 | 12/12 |
| M4 | 12/12 | 12/12 | 12/12 |
| M5 | 12/12 | 12/12 | 12/12 |

180 runs, $20.28 at list prices.

Regenerate the tables with `ax report --app webmcp-demo --csv results/published/webmcp-demo/runs.csv`.
Every run is a row in [`runs.csv`](runs.csv), a copy of the runner's
`results/runs/webmcp-demo/runs.csv`.

## Evals teams already run

| Signal | Div soup | WCAG | Patterns |
|---|---|---|---|
| axe violation nodes tagged WCAG 2.x A/AA over the seven `evalStates` (shipped: 14) | 28 | 0 | 0 |
| axe best-practice nodes (shipped: 0) | 336 | 0 | 0 |
| axe visual nodes (`color-contrast`), reported, not fixed (shipped: 91) | 91 | 91 | 91 |
| Screenshots identical across tiers, byte for byte (`ax eval pixels`, 7 states) | yes | yes | yes |

Raw output:

- [`axe.txt`](axe.txt) and [`axe.json`](axe.json) for the three tiers
- [`axe-shipped.txt`](axe-shipped.txt) for the pin itself
- [`pixels.txt`](pixels.txt) for the pixel gate

The shipped page's only WCAG-tagged axe finding is `aria-required-children`. Each widget's calendar
is a `role="grid"` of buttons with no rows, so it shows up as 2 nodes per state.

Div soup's 28 WCAG nodes are the four unlabelled Name and Email inputs, counted in each of the 7
states. Nearly all of its axe findings are the best-practice `region` rule, because the landmarks
are gone. axe doesn't flag the unnamed calendar days, the missing roles or the missing
selected-state, because a `<div>` gives it nothing to check.

## Findings

- **Every model passes almost everything at every tier, so cost is the signal.** The one failure
  is Haiku 5.5 at WCAG on M2, run 2. It booked Dec 3 at 3 PM for Grace Hopper in the **With**
  widget instead of the Without one, then claimed done. Its last message corrected itself
  mid-sentence and kept the wrong answer: "booked in the "Without WebMCP" panel... no, in the "With
  WebMCP" panel, which is the one I used."
- **Div soup costs Sonnet and both Haiku models more tokens per success than WCAG, but costs Opus
  less.** Against WCAG:

  | Model | Div soup | Patterns |
  |---|---|---|
  | Opus | −12% | −9% |
  | Sonnet | +12% | +17% |
  | Haiku 4.5 | +84% | +14% |
  | Haiku 5.5 | +10% | −9% |

  Haiku 4.5 carries the effect. At div soup it averages 18.8 tool calls and 3.5 screenshots per
  run, against 13.7 and 1.6 at WCAG, and its M1 and M2 runs cost 2–3× their WCAG runs.

  This is the first app in the set where div soup isn't the most expensive tier for every model.
  On what-iff, Headlamp and Open MCT it cost every model 9–147% more.
- **Why div soup can be cheaper: on a small page, semantics are also tokens.** A page that small
  costs few steps to scrape, and Opus does it in 8.7 tool calls per run at div soup. Each
  snapshot is also smaller there. Measured with Playwright's AI-mode aria snapshot:

  | | Div soup | WCAG | Patterns |
  |---|---|---|---|
  | Full page | 22.3k chars | 24.0k | 26.1k |
  | One widget | 2.3k chars | 3.2k | 4.1k |

  Div soup flattens the calendar into one `text:` line of day numbers. Patterns names every day
  ("Thursday, November 12, 2026"), every week row and every time. That drives the M1 and M4
  numbers in Opus's div-soup column: those tasks needed no searching, and the smaller snapshot
  won.
- **Patterns vs WCAG is mixed.** It is cheaper for Opus and Haiku 5.5 (−9% each), and dearer for
  Sonnet (+17%) and Haiku 4.5 (+14%). The fuller names that help an agent tell the widgets apart
  also lengthen every snapshot.
- **Agents fall back to scripts when the tree goes quiet.** At div soup, Opus used
  `browser_evaluate` in 8 of 15 runs and Sonnet in 6, mostly to read classes such as
  `is-selected`. At WCAG they used it in 2 and 3 runs, and at patterns in 2 and 0.

## What the WebMCP angle adds

- **The pinned driver can use WebMCP tools; this matrix didn't.** `@playwright/mcp@0.0.83` collects
  the tools a page registers through `document.modelContext` and exposes them to the agent as
  `webmcp_<name>` MCP tools. This is on by default, and `--no-webmcp` turns it off. But the
  Chromium it launches (156.0.8078.4) only has `document.modelContext` when started with
  `--enable-features=WebMCPTesting` (or `--enable-experimental-web-platform-features`). The matrix
  ran the driver as configured for the other apps, without the flag:
  - not one of the 180 runs had a `webmcp_*` tool;
  - the page showed its "This is a simulation" banner;
  - every booking went through the widget's markup, which is exactly what the tiers vary.
- **The tools were still reachable, and nobody used them.** The page also keeps its tools in
  `window.__webmcpDemoTools`, so an agent with `browser_evaluate` could have called
  `bookSlot.execute()` directly. A scan of all 180 transcripts finds none that touched the
  registry or `modelContext`. The agents read the Registered tools panel as page text, and every
  M4 answer gave the real confirmation id, not the panel's `BK-AB12CD` example.
- **The tools cover only half the page.** `bookSlot` drives only the With widget, and it doesn't
  check that a slot is open: it would book the disabled 11 AM. So with WebMCP turned on, M2 and
  M5 (the Without widget) would still need the markup. And M5's fallback rule ("if 11 isn't open,
  take the next time") would be on the agent to check with `getAvailability`.

  The markup tiers and the tools are complements, not substitutes. A run with the flag on, to
  measure the tool path against the markup path, was not done.

## Limits

- One small app and small samples: 3 runs per task per tier per model. Pass rates are at the
  ceiling, so the tiers differ only in cost, tool calls and screenshots.
- The test hook is the grader's only source of truth. It reads the widget's success line, selected
  day and slot, and inputs. A booking that never showed "Booked!" isn't counted, which matches what
  the app itself considers booked.
- The page's date is pinned by the hook, not by the app, and the same pin applies at every tier.
  Availability is month-constant, so the open-slot pattern doesn't vary within a month.
- Div soup keeps native `<input>`s (now unnamed) and `<a>` links. Class names aren't suffixed:
  there is no build step to suffix at.
- WCAG checks beyond axe were done by hand: 2.5.7 (no dragging anywhere) and 2.5.3 (every visible
  label is in its name). The `wcag` tier also fixes the selected-state gap axe can't see, which is
  the reason `wcag.patch` isn't empty.
- No task was excluded and no grader changed during the run. No run lost the API or its browser,
  so no row was dropped or rerun.
- The app has no test suite, so there is no roles signal (`ax eval roles`).
- Haiku 5.5 costs are repriced from token counts by `harness/src/pricing.ts`, as for the other
  apps, because CLI 2.1.292 misprices it.
