#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { headlamp } from '../../apps/headlamp/app.js';
import { whatIff } from '../../apps/what-iff/app.js';
import { diff, exportPatches, levelDir, parseLevel, prepare, workDir } from './prepare.js';
import { evalPixels } from './eval-pixels.js';
import { LEVELS, type AppAdapter } from './types.js';

const APPS: Record<string, AppAdapter> = { [headlamp.name]: headlamp, [whatIff.name]: whatIff };

const USAGE = `usage:
  ax prepare --app <app> [--force]
  ax diff --app <app> <from> <to> [--file <name>]
  ax patches export --app <app>
  ax serve --app <app> --level <n>   build and serve one level until Ctrl-C
  ax seed --app <app>                reset the app to its starting state (saved for grade)
  ax grade --app <app> --task <id> [--text <final answer>]   grade the last seed by hand
  ax eval pixels --app <app> [--levels 1,2,3]   L0 vs each level, byte for byte; exits 1 on a difference
  ax eval axe | roles, ax run | report   (not implemented yet)
apps: ${Object.keys(APPS).join(', ')}`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { app: { type: 'string' }, force: { type: 'boolean' }, file: { type: 'string' }, level: { type: 'string' }, task: { type: 'string' }, levels: { type: 'string' }, text: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
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
      diff(app(), parseLevel(from), parseLevel(to), values.file);
      break;
    }
    case 'patches':
      if (rest[0] !== 'export') fail(USAGE);
      exportPatches(app());
      break;
    case 'serve': {
      const a = app();
      if (!values.level) fail(`--level is required\n${USAGE}`);
      const level = parseLevel(values.level);
      if (!existsSync(levelDir(a, level))) fail(`no ${levelDir(a, level)}; run ax prepare --app ${a.name}`);
      await a.build(level, levelDir(a, level));
      const served = await a.serve(level, levelDir(a, level));
      console.log(`L${level}: ${served.url}  (Ctrl-C to stop)`);
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
      const levels = values.levels
        ? values.levels.split(',').map(parseLevel)
        : LEVELS.slice(1).filter(l => existsSync(levelDir(a, l)));
      if (!(await evalPixels(a, levels))) process.exitCode = 1;
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
