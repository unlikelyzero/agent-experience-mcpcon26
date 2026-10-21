import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { sh, waitForHttp } from '../../harness/src/exec.js';
import { TIERS, type AppAdapter, type Tier } from '../../harness/src/types.js';

/** Off 8080 (Open MCT's dev-server default), which the what-iff stack uses. */
const port = (tier: Tier) => 8090 + TIERS.indexOf(tier);

const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

const notYet = (what: string) => async (): Promise<never> => {
  throw new Error(`openmct: ${what} not implemented yet (docs/DESIGN.md §8)`);
};

export const openmct: AppAdapter = {
  name: 'openmct',
  repo: 'https://github.com/nasa/openmct.git',
  sha: 'e09bfaf47856b2b7ae2ea74334800b26fd27a41e',

  // The production bundle (`npm run build:prod` without the tsc types step) into dist/.
  async build(_tier, dir) {
    if (!existsSync(join(dir, 'node_modules'))) sh('npm', ['ci', '--no-audit', '--no-fund'], { cwd: dir, inherit: true });
    sh('npx', ['webpack', '--config', './.webpack/webpack.prod.mjs'], { cwd: dir, inherit: true });
  },

  // The repo's index.html (it loads dist/openmct.js and installs the example plugins) at `/`.
  // The prod bundle asks for its workers and themes at the site root, so everything else is dist/.
  async serve(tier, dir) {
    const dist = join(dir, 'dist');
    const server = createServer(async (req, res) => {
      const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
      const file = path === '/' ? join(dir, 'index.html') : join(dist, path.replace(/^\/dist\//, '/'));
      if (!file.startsWith(dir)) return void res.writeHead(404).end();
      try {
        const body = await readFile(file);
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

  seed: notYet('seed'),
  tasks: [],
  evalStates: [],
};
