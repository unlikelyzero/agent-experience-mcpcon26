import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sh, waitForHttp } from '../../harness/src/exec.js';
import { ROOT } from '../../harness/src/prepare.js';
import type { AppAdapter, Grade, Level, Task } from '../../harness/src/types.js';

const SHA = '3bb2082a0b30bd32e90c27b06d337f401ca7a596';
/** Must match `name:` in cluster/kind.yaml. */
const CLUSTER = 'ax-headlamp';
const image = (level: Level) => `headlamp-ax:L${level}`;
const container = (level: Level) => `headlamp-ax-L${level}`;
/** One host port per level so levels can be served side by side. */
const port = (level: Level) => 4466 + level;

const PROD = 'shop-prod';
const STAGING = 'shop-staging';
/** Same workloads, different tags, so every task has a staging look-alike (docs/DESIGN.md §4). */
const TAGS = {
  [PROD]: { CHECKOUT_TAG: '1.37.0', PAYMENTS_TAG: '1.36.1' },
  [STAGING]: { CHECKOUT_TAG: '1.36.0', PAYMENTS_TAG: '1.35.0' },
};

/** Headlamp routes are per cluster; the name is the kubeconfig context. */
const C = `/c/kind-${CLUSTER}`;
/** Leading `d` of the mdi icons on the Scale and Delete action buttons. */
const SCALE_ICON = 'M18 8H8v10H6V8a2 2 0 0 1 2-2h10z';
const DELETE_ICON = 'M19 4h-3.5l-1-1h-5l-1 1H5v2h14M6';
const icon = (d: string) => `main svg:has(path[d^="${d}"])`;

const kubectl = (args: string[], input?: string) => sh('kubectl', ['--context', `kind-${CLUSTER}`, ...args], { input });

/**
 * Everything the graders compare, flattened to `key → value`: deployment replicas and
 * images, pod UIDs per `app` label, CronJob suspend, ConfigMap UIDs. A deleted object's
 * keys are absent; a recreated one has a new UID.
 */
type State = Record<string, string>;

interface K8sObject {
  kind: string;
  metadata: { name: string; namespace: string; uid: string; labels?: Record<string, string>; deletionTimestamp?: string };
  spec?: { replicas?: number; suspend?: boolean; template?: { spec: { containers: { image: string }[] } } };
}

function clusterState(): State {
  const { items } = JSON.parse(kubectl(['get', 'deploy,pod,cronjob,configmap', '-A', '-l', 'ax=fixture', '-o', 'json'])) as { items: K8sObject[] };
  const state: State = {};
  const pods: Record<string, string[]> = {};
  for (const { kind, metadata: m, spec } of items) {
    const at = `${m.namespace}/${kind.toLowerCase()}/${m.name}`;
    if (kind === 'Deployment') {
      state[`${at}/replicas`] = String(spec?.replicas);
      state[`${at}/image`] = spec!.template!.spec.containers.map(c => c.image).join(',');
    } else if (kind === 'Pod' && !m.deletionTimestamp) {
      (pods[`${m.namespace}/pods/${m.labels?.app}`] ??= []).push(m.uid);
    } else if (kind === 'CronJob') {
      state[`${at}/suspend`] = String(spec?.suspend ?? false);
    } else if (kind === 'ConfigMap') {
      state[at] = m.uid;
    }
  }
  for (const [key, uids] of Object.entries(pods)) state[key] = uids.sort().join(',');
  return state;
}

export interface HeadlampSeed {
  state: State;
}

/**
 * Pass iff the cluster equals the seeded state with `change` applied: the target changed
 * as asked and nothing else did, staging included. `ignore` drops keys the change churns
 * on its own (new pods after a scale).
 */
function expectState(seed: HeadlampSeed, change: (s: State) => void, ignore: string[] = []): Grade {
  const want = { ...seed.state };
  change(want);
  const got = clusterState();
  const reasons: string[] = [];
  for (const key of new Set([...Object.keys(want), ...Object.keys(got)])) {
    if (ignore.includes(key) || want[key] === got[key]) continue;
    reasons.push(`${key}: want ${want[key] ?? 'absent'}, got ${got[key] ?? 'absent'}`);
  }
  return { pass: reasons.length === 0, reasons };
}

/** `tag` as a whole token: 1.36.1 matches "1.36.1." but not "1.36.10". */
const mentions = (text: string, tag: string) =>
  new RegExp(`(?<![\\w.])${tag.replaceAll('.', '\\.')}(?![\\w]|\\.\\d)`).test(text);

const tasks: Task<HeadlampSeed>[] = [
  {
    id: 'H1',
    title: 'Scale checkout in prod',
    prompt: `Scale the "checkout" deployment in the "${PROD}" namespace to 3 replicas.`,
    grade: async seed => expectState(seed, s => void (s[`${PROD}/deployment/checkout/replicas`] = '3'), [`${PROD}/pods/checkout`]),
  },
  {
    id: 'H2',
    title: 'Delete the crash-looping cart pod in prod',
    prompt: `The "cart" pod in the "${PROD}" namespace is crash-looping. Delete it.`,
    grade: async seed => expectState(seed, s => void delete s[`${PROD}/pods/cart`]),
  },
  {
    id: 'H3',
    title: 'Suspend nightly-report in prod',
    prompt: `Suspend the "nightly-report" CronJob in the "${PROD}" namespace.`,
    grade: async seed => expectState(seed, s => void (s[`${PROD}/cronjob/nightly-report/suspend`] = 'true')),
  },
  {
    id: 'H4',
    title: 'Delete feature-flags-old in prod',
    prompt: `Delete the ConfigMap "feature-flags-old" in the "${PROD}" namespace. Keep "feature-flags".`,
    grade: async seed => expectState(seed, s => void delete s[`${PROD}/configmap/feature-flags-old`]),
  },
  {
    id: 'H5',
    title: 'Report the prod payments image tag',
    prompt: `What image tag is the "payments" deployment running in the "${PROD}" namespace? Don't change anything. Name the tag in your final answer.`,
    async grade(seed, finalText) {
      const grade = expectState(seed, () => {});
      const prod = TAGS[PROD].PAYMENTS_TAG;
      const staging = TAGS[STAGING].PAYMENTS_TAG;
      if (!mentions(finalText, prod)) grade.reasons.push(`final text does not name the prod tag ${prod}`);
      if (mentions(finalText, staging)) grade.reasons.push(`final text names the staging tag ${staging}`);
      return { pass: grade.reasons.length === 0, reasons: grade.reasons };
    },
  },
];

export const headlamp: AppAdapter<HeadlampSeed> = {
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

  // Fresh namespaces every run, then wait until the UI would show the steady state:
  // deployments available and cart already in CrashLoopBackOff.
  async seed() {
    kubectl(['delete', 'namespace', PROD, STAGING, '--ignore-not-found', '--wait']);
    const template = readFileSync(join(ROOT, 'apps', 'headlamp', 'fixtures.yaml'), 'utf8');
    for (const [ns, tags] of Object.entries(TAGS)) {
      const fill = { NS: ns, ...tags };
      kubectl(['apply', '-f', '-'], template.replace(/\b(NS|CHECKOUT_TAG|PAYMENTS_TAG)\b/g, k => fill[k as keyof typeof fill]));
    }
    for (const ns of Object.keys(TAGS)) {
      for (const d of ['checkout', 'payments']) kubectl(['rollout', 'status', '-n', ns, `deployment/${d}`, '--timeout=180s']);
      kubectl(['wait', '-n', ns, 'pod/cart', '--timeout=180s',
        '--for=jsonpath={.status.containerStatuses[0].state.waiting.reason}=CrashLoopBackOff']);
    }
    return { state: clusterState() };
  },
  tasks,
  // The screens the tasks go through. Setup selectors match the icon's SVG path, which no
  // level patch touches, so they still find the control once its name and role are gone.
  evalStates: [
    { name: 'deployments', path: `${C}/deployments` },
    { name: 'deployment', path: `${C}/deployments/${PROD}/checkout` },
    { name: 'scale-dialog', path: `${C}/deployments/${PROD}/checkout`, setup: icon(SCALE_ICON) },
    { name: 'pods', path: `${C}/pods` },
    { name: 'pod', path: `${C}/pods/${PROD}/cart` },
    { name: 'cronjob', path: `${C}/cronjobs/${PROD}/nightly-report` },
    { name: 'configmaps', path: `${C}/configmaps` },
    { name: 'delete-dialog', path: `${C}/configmaps/${PROD}/feature-flags-old`, setup: icon(DELETE_ICON) },
  ],
};
