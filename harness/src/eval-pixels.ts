/**
 * `ax eval pixels`: every `evalStates` entry must screenshot byte-identical at L0 and Ln
 * (docs/DESIGN.md §2). Differing pairs are written to results/runs/pixels-<time>/.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { ROOT, levelDir } from './prepare.js';
import type { AppAdapter, EvalState, Level, Served } from './types.js';

/** The same moment at both levels, so relative times ("5m ago") render the same. */
const NOW = new Date();

/**
 * Software raster with no partial raster or LCD text. Without these the same build shot
 * three times gave three different PNGs (one anti-aliased pixel under a dialog backdrop).
 */
const DETERMINISTIC = ['--disable-gpu', '--disable-gpu-rasterization', '--disable-partial-raster',
  '--force-color-profile=srgb', '--disable-skia-runtime-opts', '--disable-lcd-text', '--font-render-hinting=none'];

async function shot(browser: Browser, url: string, state: EvalState): Promise<Buffer> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce',
  });
  try {
    const page = await context.newPage();
    await page.clock.setFixedTime(NOW);
    await page.goto(url + state.path, { waitUntil: 'networkidle' });
    if (state.setup) await page.click(state.setup);
    // Settled = two identical frames in a row; covers lazy data and transitions without per-state waits.
    let last: Buffer = Buffer.alloc(0);
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(500);
      const next = await page.screenshot({ animations: 'disabled', caret: 'hide' });
      if (next.equals(last)) return next;
      last = next;
    }
    throw new Error(`${state.name}: never settled at ${url}`);
  } finally {
    await context.close();
  }
}

async function serveLevel(app: AppAdapter, level: Level): Promise<Served> {
  const dir = levelDir(app, level);
  if (!existsSync(dir)) throw new Error(`no ${dir}; run ax prepare --app ${app.name}`);
  await app.build(level, dir);
  return app.serve(level, dir);
}

/** Returns false when any state differs. */
export async function evalPixels(app: AppAdapter, levels: Level[]): Promise<boolean> {
  if (!app.evalStates.length) throw new Error(`${app.name} has no evalStates`);
  const out = join(ROOT, 'results', 'runs', `pixels-${NOW.toISOString().replace(/[:.]/g, '-')}`);
  await app.seed();
  const browser = await chromium.launch({ args: DETERMINISTIC });
  const base = await serveLevel(app, 0);
  let ok = true;
  try {
    for (const level of levels) {
      const served = await serveLevel(app, level);
      try {
        for (const state of app.evalStates) {
          // Shoot the pair back to back and retry once: live data (a restart count) can tick
          // between two shots, a patch's difference cannot go away.
          let same = false;
          let a: Buffer = Buffer.alloc(0), b = a;
          for (let attempt = 0; attempt < 2 && !same; attempt++) {
            a = await shot(browser, base.url, state);
            b = await shot(browser, served.url, state);
            same = a.equals(b);
          }
          console.log(`${same ? 'same' : 'DIFF'}  L0 vs L${level}  ${state.name}`);
          if (!same) {
            ok = false;
            mkdirSync(out, { recursive: true });
            writeFileSync(join(out, `${state.name}-L0.png`), a);
            writeFileSync(join(out, `${state.name}-L${level}.png`), b);
          }
        }
      } finally {
        await served.stop();
      }
    }
  } finally {
    await base.stop();
    await browser.close();
  }
  if (!ok) console.log(`differing screenshots: ${out}`);
  return ok;
}
