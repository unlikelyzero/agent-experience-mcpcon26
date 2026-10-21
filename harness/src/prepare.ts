/**
 * Level worktrees. `.work/<app>/src` holds the pinned commit; `.work/<app>/L<n>`
 * is a worktree on branch `ax/L<n>`, which is `ax/L<n-1>` plus
 * `apps/<app>/levels/L<n>-<name>.patch`. See docs/DESIGN.md §7.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEVELS, LEVEL_NAMES, type AppAdapter, type Level } from './types.js';

/** Repo root; this file runs from dist/harness/src. */
export const ROOT = resolve(fileURLToPath(import.meta.url), '../../../..');

const COMMITTER = ['-c', 'user.name=ax', '-c', 'user.email=ax@localhost'];

function git(cwd: string, args: string[], inherit = false): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'inherit'] }) ?? '';
}

export const workDir = (app: AppAdapter) => join(ROOT, '.work', app.name);
export const levelDir = (app: AppAdapter, level: Level) => join(workDir(app), `L${level}`);
export const patchPath = (app: AppAdapter, level: Level) =>
  join(ROOT, 'apps', app.name, 'levels', `L${level}-${LEVEL_NAMES[level]}.patch`);

export function parseLevel(raw: string): Level {
  const n = Number(raw.replace(/^L/i, ''));
  if (!LEVELS.includes(n as Level)) throw new Error(`not a level: ${raw} (use L0–L3)`);
  return n as Level;
}

export function prepare(app: AppAdapter, { force = false } = {}): void {
  const work = workDir(app);
  if (existsSync(work)) {
    // A level worktree may hold uncommitted patch work, so never wipe it unasked.
    if (!force) throw new Error(`${work} exists. Pass --force to rebuild it (uncommitted work there is lost).`);
    rmSync(work, { recursive: true, force: true });
  }
  const src = join(work, 'src');
  mkdirSync(src, { recursive: true });
  git(src, ['init', '-q']);
  git(src, ['remote', 'add', 'origin', app.repo]);
  console.log(`fetching ${app.repo} @ ${app.sha}`);
  git(src, ['fetch', '-q', '--depth', '1', 'origin', app.sha], true);

  for (const level of LEVELS) {
    const patch = patchPath(app, level);
    const dir = levelDir(app, level);
    git(src, ['worktree', 'add', '-q', '-b', `ax/L${level}`, dir, level === 0 ? app.sha : `ax/L${level - 1}`]);
    if (level > 0 && !existsSync(patch)) {
      // Leave this level as a copy of the one below so its patch can be written there.
      console.warn(`warning: no ${patch}; L${level} is unpatched at ${dir}, stopping`);
      return;
    }
    if (level > 0) {
      git(dir, ['apply', '--index', patch], true);
      git(dir, [...COMMITTER, 'commit', '-q', '-m', `L${level} ${LEVEL_NAMES[level]}`]);
    }
    console.log(`L${level} ${LEVEL_NAMES[level]}: ${dir}`);
  }
}

/** Diff two levels. `to`'s working tree is included, so in-progress edits show. */
export function diff(app: AppAdapter, from: Level, to: Level, file?: string): void {
  const dir = levelDir(app, to);
  if (!existsSync(dir)) throw new Error(`no ${dir}; run ax prepare --app ${app.name}`);
  git(dir, ['diff', `ax/L${from}`, ...(file ? ['--', `:(glob)**/${file}`] : [])], true);
}

/**
 * Write each level's committed changes over the level below. Three-dot diff, so
 * a level branched before the level below was amended exports only its own
 * changes; `prepare --force` then rebuilds the stack on the new patches.
 */
export function exportPatches(app: AppAdapter): void {
  for (const level of LEVELS.slice(1)) {
    const dir = levelDir(app, level);
    if (!existsSync(dir)) break;
    if (git(dir, ['status', '--porcelain']).trim()) {
      console.warn(`warning: L${level} has uncommitted changes; only commits are exported`);
    }
    const patch = git(dir, ['diff', '--binary', `ax/L${level - 1}...ax/L${level}`]);
    if (!patch.trim()) {
      console.warn(`L${level}: no changes, nothing written`);
      continue;
    }
    mkdirSync(resolve(patchPath(app, level), '..'), { recursive: true });
    writeFileSync(patchPath(app, level), patch);
    console.log(`wrote ${patchPath(app, level)}`);
  }
  console.log(`rebuild the stack on these patches with: ax prepare --app ${app.name} --force`);
}
