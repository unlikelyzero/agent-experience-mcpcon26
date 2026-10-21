#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { headlamp } from '../../apps/headlamp/app.js';
import { openmct } from '../../apps/openmct/app.js';
import { whatIff } from '../../apps/what-iff/app.js';
import { diff, exportPatches, levelDir, parseLevel, prepare } from './prepare.js';
import type { AppAdapter } from './types.js';

const APPS: Record<string, AppAdapter> = { [headlamp.name]: headlamp, [openmct.name]: openmct, [whatIff.name]: whatIff };

const USAGE = `usage:
  ax prepare --app <app> [--force]
  ax diff --app <app> <from> <to> [--file <name>]
  ax patches export --app <app>
  ax serve --app <app> --level <n>   build and serve one level until Ctrl-C
  ax eval | run | report   (not implemented yet)
apps: ${Object.keys(APPS).join(', ')}`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { app: { type: 'string' }, force: { type: 'boolean' }, file: { type: 'string' }, level: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
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
    case 'eval':
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
