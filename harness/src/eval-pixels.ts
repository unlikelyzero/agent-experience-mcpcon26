/**
 * `ax eval pixels`: every `evalStates` entry must screenshot byte-identical in every tier
 * (docs/DESIGN.md §2). Each tier is compared with the first one given; an unpatched tier
 * is the app as shipped. Differing pairs are written to results/runs/pixels-<time>/.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { ROOT, tierDir } from './prepare.js';
import type { AppAdapter, EvalState, Served, Tier } from './types.js';

/** The same moment in every tier, so relative times ("5m ago") render the same. */
const NOW = new Date();

/**
 * Software raster with no partial raster or LCD text. Without these the same build shot
 * three times gave three different PNGs (one anti-aliased pixel under a dialog backdrop).
 */
const DETERMINISTIC = ['--disable-gpu', '--disable-gpu-rasterization', '--disable-partial-raster',
  '--force-color-profile=srgb', '--disable-skia-runtime-opts', '--disable-lcd-text', '--font-render-hinting=none'];

/**
 * Open `state` in a fresh context, wait until it settles (two identical frames in a row,
 * which covers lazy data and transitions without per-state waits), then hand the page and
 * its settled frame to `use`. Shared by the pixel and axe evals so both see the same state.
 */
export async function atState<T>(browser: Browser, url: string, state: EvalState, use: (page: Page, frame: Buffer) => Promise<T>): Promise<T> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce',
  });
  try {
    const page = await context.newPage();
    await page.clock.setFixedTime(NOW);
    await page.goto(url + state.path, { waitUntil: 'networkidle' });
    if (state.setup) await page.click(state.setup);
    let last: Buffer = Buffer.alloc(0);
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(500);
      const next = await page.screenshot({ animations: 'disabled', caret: 'hide' });
      if (next.equals(last)) return await use(page, next);
      last = next;
    }
    throw new Error(`${state.name}: never settled at ${url}`);
  } finally {
    await context.close();
  }
}

const shot = (browser: Browser, url: string, state: EvalState) => atState(browser, url, state, async (_, frame) => frame);

export const launch = () => chromium.launch({ args: DETERMINISTIC });

export async function serveTier(app: AppAdapter, tier: Tier): Promise<Served> {
  const dir = tierDir(app, tier);
  if (!existsSync(dir)) throw new Error(`no ${dir}; run ax prepare --app ${app.name}`);
  await app.build(tier, dir);
  return app.serve(tier, dir);
}

/** Returns false when any state differs. */
export async function evalPixels(app: AppAdapter, tiers: Tier[]): Promise<boolean> {
  if (!app.evalStates.length) throw new Error(`${app.name} has no evalStates`);
  const [first, ...others] = tiers;
  if (!first || !others.length) throw new Error('eval pixels needs at least two tiers to compare');
  const out = join(ROOT, 'results', 'runs', `pixels-${NOW.toISOString().replace(/[:.]/g, '-')}`);
  await app.seed();
  const browser = await launch();
  const base = await serveTier(app, first);
  let ok = true;
  try {
    for (const tier of others) {
      const served = await serveTier(app, tier);
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
          console.log(`${same ? 'same' : 'DIFF'}  ${first} vs ${tier}  ${state.name}`);
          if (!same) {
            ok = false;
            mkdirSync(out, { recursive: true });
            writeFileSync(join(out, `${state.name}-${first}.png`), a);
            writeFileSync(join(out, `${state.name}-${tier}.png`), b);
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
