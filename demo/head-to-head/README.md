# Head to head: div soup against WCAG

A two-slide reveal.js deck that plays two recorded agent runs side by side on what-iff's task T2:
*"Edit the memory that says the flight is at 9:40 so it says 10:15… Do not change any other memory."*

| | Claude Haiku 4.5 · div soup | Claude Opus 5.5 · WCAG |
|---|---|---|
| Result | Failed: a click on an unnamed `<div>` card starred an unrelated memory, then it reported the task complete | Passed |
| Time | 118 s | 45 s |
| Tool calls | 41 | 18 |

![The head-to-head slide at the end of both runs](preview.png)

Each lane shows the browser recording and a step log built from the agent's transcript. The log
lists every browser action, with the role and name the agent saw for what it clicked, and the
agent's own narration, timed to when the agent issued it. The verdict comes from the app's data,
not the agent's claim.

## Open it

```bash
cd demo/head-to-head && python3 -m http.server 8765
```

Then open http://localhost:8765 and press → for the second slide. **Play both** starts the two
recordings together; 1×, 2× and 4× change the speed. Opening `index.html` straight from disk also
works in Chrome.

## How it was made

The runs come from the what-iff runner on the
[`ax-tiers`](https://github.com/neupenguin/what-iff/tree/ax-tiers) branch with `AX_DEMO_VIDEO=1`,
which records the browser and writes `line-times.json` with the moment each transcript line arrived.
`assemble.sh <div-soup run dir> <wcag run dir> <task> <left label> <right label> [step to flag] [note]`
remuxes both videos, builds the step logs with `build-steps.mjs` and fills `index.template.html`.

- This Haiku run is illustrative, not typical: Haiku 4.5 passed T2 on div soup in four of the five
  recorded attempts.
- The recordings drop frames under load, so each video is mapped linearly onto its run's real
  timeline. Steps line up to within a second or two.
- The clips have no seek index, so **Play both** restarts them from the beginning rather than
  scrubbing.
