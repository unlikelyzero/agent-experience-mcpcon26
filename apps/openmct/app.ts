import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { sh, waitForHttp } from '../../harness/src/exec.js';
import { workDir } from '../../harness/src/prepare.js';
import { TIERS, type AppAdapter, type Grade, type Task, type Tier } from '../../harness/src/types.js';

const SHA = 'e09bfaf47856b2b7ae2ea74334800b26fd27a41e';

/** Off 8080 (Open MCT's dev-server default), which the what-iff stack uses. */
const port = (tier: Tier) => 8090 + TIERS.indexOf(tier);

const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};


/** One throwaway CouchDB for every tier, on upstream's image, port and default admin. */
const COUCH = 'http://localhost:5984';
const DB = 'openmct';
const ADMIN = { user: 'admin', password: 'password' };
const COUCH_CONTAINER = 'openmct-ax-couchdb';
const COUCH_PLUGIN = `openmct.plugins.CouchDB({ url: '${COUCH}/${DB}', useDesignDocuments: true })`;

async function couch(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(COUCH + path, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json', authorization: `Basic ${btoa(`${ADMIN.user}:${ADMIN.password}`)}` },
  });
  if (!res.ok) throw new Error(`couchdb ${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function startCouch(): Promise<void> {
  const running = sh('docker', ['ps', '-q', '--filter', `name=^${COUCH_CONTAINER}$`]).trim();
  if (!running) {
    sh('docker', ['rm', '-f', COUCH_CONTAINER]);
    sh('docker', ['run', '-d', '--name', COUCH_CONTAINER, '-p', '127.0.0.1:5984:5984',
      '-e', `COUCHDB_USER=${ADMIN.user}`, '-e', `COUCHDB_PASSWORD=${ADMIN.password}`, 'couchdb:3.3.2']);
  }
  await waitForHttp(`${COUCH}/_up`);
}

/** The fields an agent can change through the UI; timestamps move on every save, so they are ignored. */
const FIELDS = ['name', 'type', 'location', 'composition', 'configuration', 'telemetry', 'notes'] as const;
type Model = { name: string; type: string; location: string } & Record<string, unknown>;
type Seed = Record<string, Model>;

const id = (key: string) => ({ key, namespace: '' });
const generator = (name: string, location: string, amplitude: number): Model => ({
  name, type: 'generator', location,
  telemetry: { period: 10, amplitude, offset: 0, dataRateInHz: 1, phase: 0, randomness: 0, loadDelay: 0,
    infinityValues: false, exceedFloat32: false, staleness: false },
});
const layout = (name: string, location: string): Model =>
  ({ name, type: 'layout', location, composition: [], configuration: { items: [], layoutGrid: [10, 10] } });
/** `p` is prod, `s` staging; the two folders differ only in key prefix and generator amplitudes. */
const folder = (p: 'p' | 's', name: string, amplitude: number): Seed => ({
  [`ops-${p === 'p' ? 'prod' : 'staging'}`]: { name, type: 'folder', location: 'mine',
    composition: [id(`${p}-battery`), id(`${p}-bus`), id(`${p}-overview`)] },
  [`${p}-battery`]: generator('Battery Temp', `ops-${p === 'p' ? 'prod' : 'staging'}`, amplitude),
  [`${p}-bus`]: generator('Bus Voltage', `ops-${p === 'p' ? 'prod' : 'staging'}`, 1),
  [`${p}-overview`]: {
    name: 'Overview', type: 'flexible-layout', location: `ops-${p === 'p' ? 'prod' : 'staging'}`,
    composition: [id(`${p}-thermal`), id(`${p}-power`)],
    configuration: { rowsLayout: false, containers: [{ id: `${p}-c1`, size: 100, frames: [
      { id: `${p}-f1`, domainObjectIdentifier: id(`${p}-thermal`), size: 50, noFrame: false },
      { id: `${p}-f2`, domainObjectIdentifier: id(`${p}-power`), size: 50, noFrame: false },
    ] }] },
  },
  [`${p}-thermal`]: layout('Thermal', `${p}-overview`),
  [`${p}-power`]: layout('Power', `${p}-overview`),
});
const PROD_AMPLITUDE = 2.75;
const STAGING_AMPLITUDE = 3.25;
/** Exported for hand-checking graders without re-seeding. */
export const FIXTURE: Seed = {
  mine: { name: 'My Items', type: 'folder', location: 'ROOT', composition: [id('ops-prod'), id('ops-staging')] },
  ...folder('p', 'Ops Prod', PROD_AMPLITUDE),
  ...folder('s', 'Ops Staging', STAGING_AMPLITUDE),
};

async function current(): Promise<Seed> {
  const { rows } = await couch('GET', `/${DB}/_all_docs?include_docs=true`);
  return Object.fromEntries(rows.filter((r: any) => !r.id.startsWith('_design/')).map((r: any) => [r.id, r.doc.model]));
}

/**
 * Every seeded object keeps its FIELDS except `allowed` ones, nothing is deleted, and nothing is
 * added unless `added` accepts it. `check` adds the task's own target checks.
 */
async function grade(seed: Seed, allowed: Record<string, readonly string[]>, check: (now: (key: string) => Model, added: string[]) => string[]): Promise<Grade> {
  const now = await current();
  // A missing object is already a reason below, so checks can read it as empty.
  const get = (key: string): Model => now[key] ?? { name: '(missing)', type: '', location: '' };
  const reasons: string[] = [];
  for (const [key, before] of Object.entries(seed)) {
    const after = now[key];
    if (!after) { reasons.push(`${key} (${before.name}) was deleted`); continue; }
    for (const f of FIELDS) {
      if (!allowed[key]?.includes(f) && !isDeepStrictEqual(before[f], after[f])) reasons.push(`${key}.${f} changed`);
    }
  }
  reasons.push(...check(get, Object.keys(now).filter(k => !(k in seed))));
  return { pass: reasons.length === 0, reasons };
}
const nothingAdded = (added: string[]) => added.map(k => `unexpected new object ${k}`);
const keys = (refs: unknown) => (refs as { key: string }[] | undefined)?.map(r => r.key) ?? [];

const TASKS: Task<Seed>[] = [
  {
    id: 'O1', title: 'Create a Display Layout in the prod folder',
    prompt: 'In Open MCT, create a Display Layout named "Pass 42" inside the "Ops Prod" folder.',
    grade: (seed) => grade(seed, { 'ops-prod': ['composition'] }, (now, added) => {
      const made = added.filter(k => now(k).type === 'layout' && now(k).name === 'Pass 42');
      const [key] = made;
      if (!key || added.length !== 1) return [`expected exactly one new Display Layout "Pass 42", got ${added.map(k => `${now(k).type} "${now(k).name}"`).join(', ') || 'none'}`];
      return [
        ...(now(key).location === 'ops-prod' ? [] : [`"Pass 42" is in ${now(key).location}, not ops-prod`]),
        ...(isDeepStrictEqual(keys(now('ops-prod').composition), [...keys(seed['ops-prod']!.composition), key]) ? [] : ['ops-prod composition is not the seed plus "Pass 42"']),
      ];
    }),
  },
  {
    id: 'O2', title: 'Set a generator period',
    prompt: 'In Open MCT, set the period of the "Battery Temp" Sine Wave Generator in the "Ops Prod" folder to 20 seconds.',
    grade: (seed) => grade(seed, { 'p-battery': ['telemetry'] }, (now, added) => {
      const { period, ...rest } = now('p-battery').telemetry as Record<string, unknown>;
      const { period: _, ...seededRest } = seed['p-battery']!.telemetry as Record<string, unknown>;
      return [
        // The form may store the number as a string.
        ...(Number(period) === 20 ? [] : [`p-battery period is ${period}, not 20`]),
        ...(isDeepStrictEqual(rest, seededRest) ? [] : ['other p-battery telemetry fields changed']),
        ...nothingAdded(added),
      ];
    }),
  },
  {
    id: 'O3', title: 'Reorder a Flexible Layout',
    prompt: 'In Open MCT, open the "Overview" Flexible Layout in the "Ops Prod" folder and move the "Power" frame above the "Thermal" frame. Save the layout.',
    grade: (seed) => grade(seed, { 'p-overview': ['configuration'] }, (now, added) => {
      const containers = (now('p-overview').configuration as { containers: { frames: { domainObjectIdentifier: { key: string } }[] }[] }).containers;
      const order = containers.flatMap(c => c.frames.map(f => f.domainObjectIdentifier.key));
      return [
        ...(isDeepStrictEqual(order, ['p-power', 'p-thermal']) ? [] : [`p-overview frames are ${order.join(', ')}, not p-power, p-thermal`]),
        ...nothingAdded(added),
      ];
    }),
  },
  {
    id: 'O4', title: 'Rename an object',
    prompt: 'In Open MCT, rename the "Bus Voltage" Sine Wave Generator in the "Ops Prod" folder to "Bus Voltage (A)".',
    grade: (seed) => grade(seed, { 'p-bus': ['name'] }, (now, added) => [
      ...(now('p-bus').name === 'Bus Voltage (A)' ? [] : [`p-bus is named "${now('p-bus').name}"`]),
      ...nothingAdded(added),
    ]),
  },
  {
    id: 'O5', title: 'Read a property',
    prompt: 'In Open MCT, what is the amplitude of the "Battery Temp" Sine Wave Generator in the "Ops Prod" folder? Give the number in your final answer.',
    grade: (seed, finalText) => grade(seed, {}, (_now, added) => [
      ...(finalText.includes(String(PROD_AMPLITUDE)) ? [] : [`final answer does not name ${PROD_AMPLITUDE}`]),
      ...(finalText.includes(String(STAGING_AMPLITUDE)) ? [`final answer names staging's ${STAGING_AMPLITUDE}`] : []),
      ...nothingAdded(added),
    ]),
  },
];

export const openmct: AppAdapter<Seed> = {
  name: 'openmct',
  repo: 'https://github.com/nasa/openmct.git',
  sha: SHA,

  // The production bundle (`npm run build:prod` without the tsc types step) into dist/.
  async build(_tier, dir) {
    if (!existsSync(join(dir, 'node_modules'))) sh('npm', ['ci', '--no-audit', '--no-fund'], { cwd: dir, inherit: true });
    sh('npx', ['webpack', '--config', './.webpack/webpack.prod.mjs'], { cwd: dir, inherit: true });
  },

  // The repo's index.html (it loads dist/openmct.js and installs the example plugins) at `/`.
  // The prod bundle asks for its workers and themes at the site root, so everything else is dist/.
  // Persistence is CouchDB, not localStorage, so graders can read it (DESIGN.md §10). The
  // index.html rewrite is upstream's replace-localstorage-with-couchdb-indexhtml.sh, at every tier.
  async serve(tier, dir) {
    await startCouch();
    const dist = join(dir, 'dist');
    const server = createServer(async (req, res) => {
      const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
      const file = path === '/' ? join(dir, 'index.html') : join(dist, path.replace(/^\/dist\//, '/'));
      if (!file.startsWith(dir)) return void res.writeHead(404).end();
      try {
        let body: Buffer | string = await readFile(file);
        if (path === '/') body = body.toString().replace('openmct.plugins.LocalStorage()', COUCH_PLUGIN);
        res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
      } catch {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>(resolve => server.listen(port(tier), '127.0.0.1', resolve));
    const url = `http://localhost:${port(tier)}`;
    await waitForHttp(url);
    return { url, stop: () => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }) };
  },

  // A fresh database holding FIXTURE. Returns the seeded models; graders compare against them.
  async seed() {
    await startCouch();
    await couch('DELETE', `/${DB}`).catch(() => {});
    // Recreates the database, its public _security and the design documents the app queries.
    const script = sh('git', ['-C', join(workDir(openmct), 'src'), 'show', `${SHA}:src/plugins/persistence/couch/setup-couchdb.sh`]);
    execFileSync('bash', ['-c', script], { stdio: 'ignore', env: { ...process.env, OPENMCT_DATABASE_NAME: DB, COUCH_ADMIN_USER: ADMIN.user,
      COUCH_ADMIN_PASSWORD: ADMIN.password, COUCH_BASE_LOCAL: COUCH, COUCH_NODE_NAME: 'nonode@nohost' } });
    const now = Date.now();
    await couch('POST', `/${DB}/_bulk_docs`, { docs: Object.entries(FIXTURE).map(([key, model]) => ({
      _id: key, metadata: { category: 'domain object', type: model.type, owner: 'admin', name: model.name },
      model: { ...model, created: now, modified: now, persisted: now },
    })) });
    return FIXTURE;
  },

  tasks: TASKS,
  // The axe scan in DESIGN.md §10 also covers the create dialog and Edit Properties, which take
  // two clicks; `setup` is one selector, so they wait for multi-step setup.
  evalStates: [
    { name: 'prod-folder', path: '/#/browse/mine/ops-prod' },
    { name: 'battery-temp', path: '/#/browse/mine/ops-prod/p-battery' },
    { name: 'overview', path: '/#/browse/mine/ops-prod/p-overview' },
    { name: 'overview-editing', path: '/#/browse/mine/ops-prod/p-overview', setup: '.l-browse-bar__actions__edit' },
    { name: 'create-menu', path: '/#/browse/mine/ops-prod', setup: '.c-create-button' },
    { name: 'more-actions', path: '/#/browse/mine/ops-prod/p-battery', setup: 'button.l-browse-bar__actions.icon-3-dots' },
    { name: 'conductor-popup', path: '/#/browse/mine/ops-prod', setup: '.c-compact-tc__setting-value' },
  ],
};
