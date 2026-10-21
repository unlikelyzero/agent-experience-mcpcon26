#!/usr/bin/env python3
"""Render design boards to print PDF / PNG and verify the QR code.

Usage (from the poster/ folder):
  python3 scripts/render.py pdf  [Board ...]   # default board: AGNTCon-Poster
  python3 scripts/render.py png  --dpi 100 [Board ...]
  python3 scripts/render.py qr                 # decode the QR in dist/AX-poster_36x24.pdf

Needs: pip install playwright opencv-python-headless ; poppler-utils (pdftoppm).
Set CHROMIUM=/path/to/chrome if Playwright's bundled browser isn't installed.
"""
import argparse, asyncio, json, os, re, subprocess, sys, glob
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DESIGN, ASSETS, FONTS, DIST, BUILD = (ROOT / d for d in ("design", "assets", "fonts", "dist", "build"))
BLOBS = json.loads((ASSETS / "blob-map.json").read_text())
SIZES = {"Card-Front": (576, 384), "Card-Back": (576, 384)}  # everything else is 3456x2304 (36x24 in @ 96 css px/in)
OUTNAME = {"AGNTCon-Poster": "AX-poster_36x24"}

FONT_CSS = """<style>
@font-face{font-family:'IBM Plex Mono';font-weight:400;src:url(../fonts/ibm-plex-mono-latin-400-normal.woff2)}
@font-face{font-family:'IBM Plex Mono';font-weight:600;src:url(../fonts/ibm-plex-mono-latin-600-normal.woff2)}
@font-face{font-family:'Open Sans';font-weight:400;src:url(../fonts/open-sans-latin-400-normal.woff2)}
@font-face{font-family:'Open Sans';font-weight:700;src:url(../fonts/open-sans-latin-700-normal.woff2)}
@page{margin:0}
html,body{margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
</style>"""


def static_html(board: str) -> Path:
    """Turn a .dc.html board into a plain HTML page with local assets and fonts."""
    t = (DESIGN / f"{board}.dc.html").read_text()
    for blob, fname in BLOBS.items():
        t = t.replace(f"/_blob/{blob}", f"../assets/{fname}")
    t = t.replace('<script src="./support.js"></script>', "")
    t = re.sub(r'<link rel="(stylesheet|preconnect)"[^>]*>', "", t)
    t = t.replace("</head>", FONT_CSS + "</head>", 1)
    for tag in ("<x-dc>", "</x-dc>", "<helmet>", "</helmet>"):
        t = t.replace(tag, "")
    t = re.sub(r'<script type="text/x-dc".*?</script>', "", t, flags=re.S)
    BUILD.mkdir(exist_ok=True)
    out = BUILD / f"{board}.html"
    out.write_text(t)
    return out


async def run(mode, boards, dpi):
    from playwright.async_api import async_playwright
    DIST.mkdir(exist_ok=True)
    async with async_playwright() as p:
        kw = {"args": ["--no-sandbox"]}
        if os.environ.get("CHROMIUM"):
            kw["executable_path"] = os.environ["CHROMIUM"]
        browser = await p.chromium.launch(**kw)
        for board in boards:
            w, h = SIZES.get(board, (3456, 2304))
            page = await browser.new_page(viewport={"width": w, "height": h},
                                          device_scale_factor=(dpi / 96 if mode == "png" else 1))
            await page.goto(static_html(board).as_uri())
            await page.evaluate("document.fonts.ready")
            await page.wait_for_timeout(800)
            name = OUTNAME.get(board, board)
            if mode == "pdf":
                out = DIST / f"{name}.pdf"
                await page.pdf(path=str(out), width=f"{w/96}in", height=f"{h/96}in", print_background=True,
                               margin={"top": "0", "right": "0", "bottom": "0", "left": "0"})
            else:
                out = DIST / f"{name}_{dpi}dpi.png"
                await page.screenshot(path=str(out))
            print("wrote", out.relative_to(ROOT))
            await page.close()
        await browser.close()


def check_qr():
    import cv2
    pdf = DIST / "AX-poster_36x24.pdf"
    BUILD.mkdir(exist_ok=True)
    for f in glob.glob(str(BUILD / "qr*.png")):
        os.remove(f)
    # bottom-left "Try it yourself" card, rasterized at 100 dpi
    subprocess.run(["pdftoppm", "-png", "-r", "100", "-x", "0", "-y", "1900", "-W", "900", "-H", "500",
                    str(pdf), str(BUILD / "qr")], check=True)
    img = cv2.imread(glob.glob(str(BUILD / "qr*.png"))[0])
    value, _, _ = cv2.QRCodeDetector().detectAndDecode(img)
    print("QR decodes to:", repr(value))
    sys.exit(0 if value else 1)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["pdf", "png", "qr"])
    ap.add_argument("boards", nargs="*", default=["AGNTCon-Poster"])
    ap.add_argument("--dpi", type=int, default=100)
    a = ap.parse_args()
    if a.mode == "qr":
        check_qr()
    else:
        asyncio.run(run(a.mode, a.boards, a.dpi))
