import type { AppAdapter } from '../../harness/src/types.js';

const notYet = (what: string) => async (): Promise<never> => {
  throw new Error(`what-iff: ${what} not ported yet (docs/DESIGN.md §8, step 6)`);
};

export const whatIff: AppAdapter = {
  name: 'what-iff',
  repo: 'https://github.com/theimaginaryfoundation/what-iff.git',
  sha: 'd50ee4f3184cd2560b1a94e6500ae3ab2f17fc3c',
  build: notYet('build'),
  serve: notYet('serve'),
  seed: notYet('seed'),
  tasks: [],
  evalStates: [],
};
