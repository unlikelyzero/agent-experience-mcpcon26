/**
 * `ax eval axe`: axe-core over every `evalStates` entry, per tier (docs/DESIGN.md §2, §6).
 * Violations are split into WCAG (tagged wcag2a/2aa/21a/21aa/22aa), visual (reported, never
 * fixed: fixing them changes the pixels) and best-practice. The `wcag` and `patterns` tiers
 * must have no WCAG violations; that is the definition of the `wcag` tier being done.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { atState, launch, serveTier } from './eval-pixels.js';
import { ROOT } from './prepare.js';
import type { AppAdapter, Tier } from './types.js';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const VISUAL = ['color-contrast', 'color-contrast-enhanced', 'link-in-text-block', 'target-size'];
/** Tiers that must be WCAG-clean. `patterns` is the `wcag` bar plus more. */
const GATED: Tier[] = ['wcag', 'patterns'];

const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

type Category = 'wcag' | 'visual' | 'best-practice';
interface Violation { id: string; impact: string | null; tags: string[]; help: string; nodes: { target: string[] }[] }
interface Finding { tier: Tier; state: string; category: Category; rule: string; impact: string | null; help: string; targets: string[] }

const categorize = (v: Violation): Category =>
  VISUAL.includes(v.id) ? 'visual' : v.tags.some(t => WCAG_TAGS.includes(t)) ? 'wcag' : 'best-practice';

/** Returns false when a gated tier has a WCAG violation. */
export async function evalAxe(app: AppAdapter, tiers: Tier[]): Promise<boolean> {
  if (!app.evalStates.length) throw new Error(`${app.name} has no evalStates`);
  const out = join(ROOT, 'results', 'runs', `axe-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await app.seed();
  const browser = await launch();
  const findings: Finding[] = [];
  try {
    for (const tier of tiers) {
      const served = await serveTier(app, tier);
      try {
        for (const state of app.evalStates) {
          const violations = await atState(browser, served.url, state, async page => {
            await page.addScriptTag({ content: AXE });
            // Every rule axe enables by default; categorize() sorts the results.
            return page.evaluate(() => (window as any).axe.run(document).then((r: any) => r.violations)) as Promise<Violation[]>;
          });
          for (const v of violations) {
            findings.push({ tier, state: state.name, category: categorize(v), rule: v.id, impact: v.impact, help: v.help, targets: v.nodes.map(n => n.target.join(' ')) });
          }
        }
      } finally {
        await served.stop();
      }
    }
  } finally {
    await browser.close();
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'axe.json'), JSON.stringify(findings, null, 2));

  let ok = true;
  for (const tier of tiers) {
    const mine = findings.filter(f => f.tier === tier);
    const count = (c: Category) => mine.filter(f => f.category === c).reduce((n, f) => n + f.targets.length, 0);
    const gated = GATED.includes(tier);
    if (gated && count('wcag')) ok = false;
    console.log(`${tier}: wcag ${count('wcag')}, visual ${count('visual')}, best-practice ${count('best-practice')} (nodes)` +
      (gated ? (count('wcag') ? '  FAIL: must be WCAG-clean' : '  WCAG-clean') : ''));
    for (const f of mine) console.log(`  ${f.state.padEnd(14)} ${f.category.padEnd(13)} ${f.rule} ×${f.targets.length}  ${f.help}`);
  }
  console.log(`details: ${join(out, 'axe.json')}`);
  return ok;
}
