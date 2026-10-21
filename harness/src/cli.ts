#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { headlamp } from '../../apps/headlamp/app.js';
import { whatIff } from '../../apps/what-iff/app.js';
import { diff, exportPatches, parseTier, prepare, tierDir } from './prepare.js';
import { TIERS, type AppAdapter } from './types.js';

const APPS: Record<string, AppAdapter> = { [headlamp.name]: headlamp, [whatIff.name]: whatIff };

const USAGE = `usage:
  ax prepare --app <app> [--force]
  ax diff --app <app> <from> <to> [--file <name>]   tiers, or 'shipped' as <from>
  ax patches export --app <app>
  ax serve --app <app> --tier <tier>   build and serve one tier until Ctrl-C
  ax eval | run | report   (not implemented yet)
apps: ${Object.keys(APPS).join(', ')}
tiers: ${TIERS.join(', ')}`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { app: { type: 'string' }, force: { type: 'boolean' }, file: { type: 'string' }, tier: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
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
