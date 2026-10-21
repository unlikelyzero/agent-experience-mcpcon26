import type { AppAdapter } from '../../harness/src/types.js';

const notYet = (what: string) => async (): Promise<never> => {
  throw new Error(`headlamp: ${what} not implemented yet (docs/DESIGN.md §8)`);
};

export const headlamp: AppAdapter = {
  name: 'headlamp',
  repo: 'https://github.com/kubernetes-sigs/headlamp.git',
  sha: '3bb2082a0b30bd32e90c27b06d337f401ca7a596',
  build: notYet('build'),
  serve: notYet('serve'),
  seed: notYet('seed'),
  tasks: [],
  evalStates: [],
};
