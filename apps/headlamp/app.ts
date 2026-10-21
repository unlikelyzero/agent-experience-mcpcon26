import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sh, waitForHttp } from '../../harness/src/exec.js';
import { ROOT } from '../../harness/src/prepare.js';
import type { AppAdapter, Level } from '../../harness/src/types.js';

const SHA = '3bb2082a0b30bd32e90c27b06d337f401ca7a596';
/** Must match `name:` in cluster/kind.yaml. */
const CLUSTER = 'ax-headlamp';
const image = (level: Level) => `headlamp-ax:L${level}`;
const container = (level: Level) => `headlamp-ax-L${level}`;
/** One host port per level so levels can be served side by side. */
const port = (level: Level) => 4466 + level;

const notYet = (what: string) => async (): Promise<never> => {
  throw new Error(`headlamp: ${what} not implemented yet (docs/DESIGN.md §8)`);
};

export const headlamp: AppAdapter = {
  name: 'headlamp',
  repo: 'https://github.com/kubernetes-sigs/headlamp.git',
  sha: SHA,

  // Headlamp's `npm run image:build`, with our tag and without `--platform=local`, which
  // means darwin on a Mac. The default is the daemon's linux platform. HEADLAMP_SOURCE_COMMIT
  // is the pin at every level: the UI shows it, and a per-level commit would break pixel identity.
  async build(level, dir) {
    sh('docker', ['buildx', 'build', '--load', '--build-arg', `HEADLAMP_SOURCE_COMMIT=${SHA}`,
      '-t', image(level), '-f', 'Dockerfile', '.'], { cwd: dir, inherit: true });
  },

  // The container joins kind's docker network and reaches the API server by its
  // in-network name (`kind get kubeconfig --internal`), which works on Docker Desktop too.
  async serve(level) {
    const kubeconfig = join(ROOT, '.work', 'headlamp', 'kubeconfig');
    writeFileSync(kubeconfig, sh('kind', ['get', 'kubeconfig', '--internal', '--name', CLUSTER]));
    // Read by the container's non-root user. Throwaway local cluster; .work/ is gitignored.
    chmodSync(kubeconfig, 0o644);
    sh('docker', ['rm', '-f', container(level)]);
    // No --rm, so `docker logs` still works when the server exits on startup; stop() removes it.
    sh('docker', ['run', '-d', '--name', container(level), '--network', 'kind',
      '-p', `127.0.0.1:${port(level)}:4466`, '-v', `${kubeconfig}:/headlamp/kubeconfig:ro`,
      image(level), '-kubeconfig', '/headlamp/kubeconfig']);
    const url = `http://localhost:${port(level)}`;
    try {
      await waitForHttp(url);
    } catch (error) {
      sh('docker', ['logs', container(level)], { inherit: true });
      throw error;
    }
    return { url, stop: async () => void sh('docker', ['rm', '-f', container(level)]) };
  },

  seed: notYet('seed'),
  tasks: [],
  evalStates: [],
};
