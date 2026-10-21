/** The adapter contract every app implements. See docs/DESIGN.md §3. */

/** See docs/DESIGN.md §2. Each tier is an independent patch on the pin: `tiers/<tier>.patch`. */
export const TIERS = ['div-soup', 'wcag', 'patterns'] as const;
export type Tier = (typeof TIERS)[number];

export interface Grade {
  pass: boolean;
  /** One line per failed check; empty when `pass`. */
  reasons: string[];
}

export interface Task<Seed = unknown> {
  id: string;
  title: string;
  /** The instruction given to the agent, after the shared preamble. */
  prompt: string;
  /** Reads state outside the UI (kubectl, API). `finalText` is the agent's last message. */
  grade(seed: Seed, finalText: string): Promise<Grade>;
}

export interface EvalState {
  name: string;
  /** Path relative to the served URL. */
  path: string;
  /** Selector clicked after load to reach the state (a menu, a dialog). */
  setup?: string;
}

export interface Served {
  url: string;
  stop(): Promise<void>;
}

export interface AppAdapter<Seed = unknown> {
  name: string;
  /** Git URL of the upstream repo. */
  repo: string;
  /** Pinned commit. */
  sha: string;
  build(tier: Tier, dir: string): Promise<void>;
  serve(tier: Tier, dir: string): Promise<Served>;
  seed(): Promise<Seed>;
  tasks: Task<Seed>[];
  evalStates: EvalState[];
}

/** One agent run: one CSV row. Field names match the CSV columns. */
export interface RunRecord {
  timestamp: string;
  app: string;
  tier: Tier;
  driver: string;
  task: string;
  run: number;
  pass: boolean;
  claimed_done: boolean;
  claim_correct: boolean;
  tool_calls: number;
  browser_tool_calls: number;
  screenshots: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost_usd: number;
  wall_ms: number;
  turns: number;
  exit_code: number | null;
  timed_out: boolean;
  fail_reasons: string;
  transcript: string;
}
