#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { headlamp } from '../../apps/headlamp/app.js';
import { whatIff } from '../../apps/what-iff/app.js';
import { evalPixels } from './eval-pixels.js';
import { diff, exportPatches, parseTier, prepare, tierDir, workDir } from './prepare.js';
import { TIERS, type AppAdapter } from './types.js';

const APPS: Record<string, AppAdapter> = { [headlamp.name]: headlamp, [whatIff.name]: whatIff };

const USAGE = `usage:
  ax prepare --app <app> [--force]
  ax diff --app <app> <from> <to> [--file <name>]   tiers, or 'shipped' as <from>
  ax patches export --app <app>
  ax serve --app <app> --tier <tier>   build and serve one tier until Ctrl-C
  ax seed --app <app>                reset the app to its starting state (saved for grade)
  ax grade --app <app> --task <id> [--text <final answer>]   grade the last seed by hand
  ax eval pixels --app <app> [--tiers a,b,…]   every tier vs the first, byte for byte; exits 1 on a difference
  ax eval axe | roles, ax run | report   (not implemented yet)
apps: ${Object.keys(APPS).join(', ')}
tiers: ${TIERS.join(', ')}`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { app: { type: 'string' }, force: { type: 'boolean' }, file: { type: 'string' }, tier: { type: 'string' }, tiers: { type: 'string' }, task: { type: 'string' }, text: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
});

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function app(): AppAdapter {
  if (!values.app) fail(`--app is required\n${USAGE}`);
  return APPS[values.app] ?? fail(`unknown app: ${values.app}\n${USAGE}`);
}

const [command, ...rest] = positionals;
try {
  switch (command) {
    case 'prepare':
      prepare(app(), { force: values.force });
      break;
    case 'diff': {
      const [from, to] = rest;
      if (!from || !to) fail(USAGE);
      diff(app(), from, to, values.file);
      break;
    }
    case 'patches':
      if (rest[0] !== 'export') fail(USAGE);
      exportPatches(app());
      break;
    case 'serve': {
      const a = app();
      if (!values.tier) fail(`--tier is required\n${USAGE}`);
      const tier = parseTier(values.tier);
      if (!existsSync(tierDir(a, tier))) fail(`no ${tierDir(a, tier)}; run ax prepare --app ${a.name}`);
      await a.build(tier, tierDir(a, tier));
      const served = await a.serve(tier, tierDir(a, tier));
      console.log(`${tier}: ${served.url}  (Ctrl-C to stop)`);
      process.once('SIGINT', () => void served.stop().then(() => process.exit(0)));
      setInterval(() => {}, 1 << 30); // keep the process alive until Ctrl-C
      break;
    }
    case 'seed': {
      const a = app();
      writeFileSync(join(workDir(a), 'seed.json'), JSON.stringify(await a.seed(), null, 2));
      console.log(`seeded ${a.name}; saved ${join(workDir(a), 'seed.json')}`);
      break;
    }
    case 'grade': {
      const a = app();
      const task = a.tasks.find(t => t.id === values.task) ?? fail(`unknown --task ${values.task}; have ${a.tasks.map(t => t.id).join(', ')}`);
      const seedFile = join(workDir(a), 'seed.json');
      if (!existsSync(seedFile)) fail(`no ${seedFile}; run ax seed --app ${a.name}`);
      const grade = await task.grade(JSON.parse(readFileSync(seedFile, 'utf8')), values.text ?? '');
      console.log(grade.pass ? `${task.id} PASS` : `${task.id} FAIL\n  ${grade.reasons.join('\n  ')}`);
      process.exitCode = grade.pass ? 0 : 1;
      break;
    }
    case 'eval': {
      if (rest[0] !== 'pixels') fail(`ax eval ${rest[0] ?? ''}: not implemented yet (docs/DESIGN.md §8)`);
      const a = app();
      const tiers = values.tiers ? values.tiers.split(',').map(parseTier) : TIERS.filter(t => existsSync(tierDir(a, t)));
      if (!(await evalPixels(a, tiers))) process.exitCode = 1;
      break;
    }
    case 'run':
    case 'report':
      fail(`ax ${command}: not implemented yet (docs/DESIGN.md §8)`);
    default:
      if (values.help) {
        console.log(USAGE);
        break;
      }
      fail(USAGE);
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
