# Poster

Source of the AGNTCon + MCPCon 2026 poster (v46), 36×24 in landscape. The printed v45 is
commit `31d2af0`; v46 changes only the Haiku 4.5 numbers to the finished runs.

| Path | What |
|---|---|
| `design/AGNTCon-Poster.dc.html` | The poster, 3456×2304 CSS px (36×24 in at 96 px/in) |
| `design/Card-Front.dc.html`, `design/Card-Back.dc.html` | The handout card, 576×384 CSS px; the back's QR points to this repo |
| `assets/` | Logos and the QR code, referenced as `/_blob/<id>`; `blob-map.json` maps ids to files |
| `fonts/` | Open Sans and IBM Plex Mono, for an offline render |
| `scripts/render.py` | Inlines assets and fonts, then prints the vector PDF or a PNG proof, and decodes the QR |

```bash
pip install playwright opencv-python-headless && python3 -m playwright install chromium
cd poster
python3 scripts/render.py pdf        # dist/AX-poster_36x24.pdf
python3 scripts/render.py png --dpi 100
python3 scripts/render.py png Card-Front Card-Back --dpi 100
python3 scripts/render.py qr         # must decode to the evals repo URL
```

`dist/` and `build/` are gitignored. The results table quotes
[`results/published/what-iff`](../results/published/what-iff/README.md) with the finished
Haiku 4.5 runs (4 tasks × 3 runs per cell), before the Haiku 5.5 runs were added.
