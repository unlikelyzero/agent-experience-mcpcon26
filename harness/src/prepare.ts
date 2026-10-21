/**
 * Tier worktrees. `.work/<app>/src` holds the pinned commit; `.work/<app>/<tier>`
 * is a worktree on branch `ax/<tier>`, which is the pin plus
 * `apps/<app>/tiers/<tier>.patch`. Tiers are independent of each other.
 * See docs/DESIGN.md §2 and §7.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sh } from './exec.js';
import { TIERS, type AppAdapter, type Tier } from './types.js';

/** Repo root; this file runs from dist/harness/src. */
export const ROOT = resolve(fileURLToPath(import.meta.url), '../../../..');

const COMMITTER = ['-c', 'user.name=ax', '-c', 'user.email=ax@localhost'];
/** `ax diff` accepts this in place of a tier to mean the app as shipped. */
const SHIPPED = 'shipped';

const git = (cwd: string, args: string[], inherit = false) => sh('git', args, { cwd, inherit });

export const workDir = (app: AppAdapter) => join(ROOT, '.work', app.name);
export const tierDir = (app: AppAdapter, tier: Tier) => join(workDir(app), tier);
export const patchPath = (app: AppAdapter, tier: Tier) => join(ROOT, 'apps', app.name, 'tiers', `${tier}.patch`);

export function parseTier(raw: string): Tier {
  if (!(TIERS as readonly string[]).includes(raw)) throw new Error(`not a tier: ${raw} (use ${TIERS.join(', ')})`);
  return raw as Tier;
}

export function prepare(app: AppAdapter, { force = false } = {}): void {
  const work = workDir(app);
  if (existsSync(work)) {
    // A tier worktree may hold uncommitted patch work, so never wipe it unasked.
    if (!force) throw new Error(`${work} exists. Pass --force to rebuild it (uncommitted work there is lost).`);
    rmSync(work, { recursive: true, force: true });
  }
  const src = join(work, 'src');
  mkdirSync(src, { recursive: true });
  git(src, ['init', '-q']);
  git(src, ['remote', 'add', 'origin', app.repo]);
  console.log(`fetching ${app.repo} @ ${app.sha}`);
  git(src, ['fetch', '-q', '--depth', '1', 'origin', app.sha], true);

  for (const tier of TIERS) {
    const dir = tierDir(app, tier);
    git(src, ['worktree', 'add', '-q', '-b', `ax/${tier}`, dir, app.sha]);
    if (existsSync(patchPath(app, tier))) {
      git(dir, ['apply', '--index', patchPath(app, tier)], true);
      git(dir, [...COMMITTER, 'commit', '-q', '-m', tier]);
      console.log(`${tier}: ${dir}`);
    } else {
      // Left as the shipped app so the tier's patch can be written there.
      console.warn(`${tier}: no ${patchPath(app, tier)}; unpatched at ${dir}`);
    }
  }
}

/** Diff two tiers (or `shipped`). `to`'s working tree is included, so in-progress edits show. */
export function diff(app: AppAdapter, from: string, to: string, file?: string): void {
  const toTier = parseTier(to);
  const base = from === SHIPPED ? app.sha : `ax/${parseTier(from)}`;
  const dir = tierDir(app, toTier);
  if (!existsSync(dir)) throw new Error(`no ${dir}; run ax prepare --app ${app.name}`);
  git(dir, ['diff', base, ...(file ? ['--', `:(glob)**/${file}`] : [])], true);
}

/** Write each tier's committed changes against the pin. */
export function exportPatches(app: AppAdapter): void {
  for (const tier of TIERS) {
    const dir = tierDir(app, tier);
    if (!existsSync(dir)) continue;
    if (git(dir, ['status', '--porcelain']).trim()) {
      console.warn(`warning: ${tier} has uncommitted changes; only commits are exported`);
    }
    const patch = git(dir, ['diff', '--binary', app.sha, `ax/${tier}`]);
    if (!patch.trim()) {
      console.warn(`${tier}: no changes, nothing written`);
      continue;
    }
    mkdirSync(resolve(patchPath(app, tier), '..'), { recursive: true });
    writeFileSync(patchPath(app, tier), patch);
    console.log(`wrote ${patchPath(app, tier)}`);
  }
}
