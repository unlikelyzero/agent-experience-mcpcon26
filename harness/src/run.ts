/**
 * `ax run`: the agent matrix. For every run it seeds the app, starts `claude -p` on one task at one
 * tier with a browser driver as its only tool, grades the result from app state, and appends a row
 * to results/runs/<app>/runs.csv. Tiers are interleaved inside each run index so drift over a long
 * session (rate limits, model load) spreads across tiers. See docs/DESIGN.md §5–6.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupDriver, type DriverName } from './drivers.js';
import { serveTier } from './eval-pixels.js';
import { ROOT } from './prepare.js';
import { CLI_PRICE_FACTOR, RATES, repriceTranscript } from './pricing.js';
import { parseStreamJson } from './stream-metrics.js';
import type { AppAdapter, RunRecord, Served, Task, Tier } from './types.js';

export const DONE_MARKER = 'TASK_COMPLETE';

export const RUN_COLUMNS: (keyof RunRecord)[] = ['model', 'tier', 'task', 'run', 'pass', 'claimed_done', 'claim_correct',
  'tool_calls', 'browser_tool_calls', 'screenshots', 'input_tokens', 'output_tokens', 'cache_read_tokens',
  'cache_creation_tokens', 'cost_usd', 'wall_ms', 'turns', 'exit_code', 'timed_out', 'timestamp', 'fail_reasons'];

export interface RunOptions {
  tiers: Tier[];
  models: string[];
  tasks: string[];
  runs: number;
  /** Real dollars per run; scaled for models the CLI misprices. */
  maxBudgetUsd: number;
  driver: DriverName;
  timeoutMin: number;
  dryRun: boolean;
}

export function buildPrompt(task: Task, url: string): string {
  return [
    'You are operating a web app in a real browser through your browser tools. Use only the browser to complete the task;',
    'do not call the app API directly, read source code, or use any other tool to change data.',
    '',
    `Open ${url}`,
    '',
    `Task: ${task.prompt}`,
    '',
    `When you believe the task is complete, end your final message with the line ${DONE_MARKER}.`,
    'If you cannot complete it, explain why and do not print that line.',
  ].join('\n');
}

const claimedDone = (text: string) => text.split('\n').some(line => line.trim() === DONE_MARKER);

interface ClaudeRun { transcript: string; exitCode: number | null; timedOut: boolean; wallMs: number }

function runClaude(prompt: string, args: string[], env: Record<string, string>, timeoutMs: number): Promise<ClaudeRun> {
  return new Promise(resolve => {
    const started = Date.now();
    // An empty directory outside any repo, so no project CLAUDE.md or AGENTS.md is discovered.
    const child = spawn('claude', ['-p', prompt, '--output-format', 'stream-json', '--verbose', ...args], {
      cwd: mkdtempSync(join(tmpdir(), 'ax-run-')),
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let transcript = '';
    let timedOut = false;
    child.stdout.on('data', (chunk: Buffer) => (transcript += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => process.stderr.write(chunk));
    const timer = setTimeout(() => ((timedOut = true), child.kill('SIGTERM')), timeoutMs);
    child.on('close', code => (clearTimeout(timer), resolve({ transcript, exitCode: code, timedOut, wallMs: Date.now() - started })));
  });
}

const csvCell = (v: unknown) => String(v ?? '').replace(/[,\n]/g, ';');

export async function runMatrix(app: AppAdapter, opts: RunOptions): Promise<void> {
  const tasks = app.tasks.filter(t => opts.tasks.length === 0 || opts.tasks.includes(t.id));
  if (!tasks.length) throw new Error(`no tasks match ${opts.tasks.join(',')} (have ${app.tasks.map(t => t.id).join(',')})`);
  const outDir = join(ROOT, 'results', 'runs', app.name);
  const csv = join(outDir, 'runs.csv');
  mkdirSync(outDir, { recursive: true });
  if (!existsSync(csv)) writeFileSync(csv, RUN_COLUMNS.join(',') + '\n');
  // Resume: a cell already in the CSV (a stopped matrix, a network outage) is not run again.
  const done = new Set(readFileSync(csv, 'utf8').trim().split('\n').slice(1).map(line => {
    const [model, tier, task, run] = line.split(',');
    return `${model},${tier},${task},${run}`;
  }));

  const served = new Map<Tier, Served>();
  try {
    if (!opts.dryRun) for (const tier of opts.tiers) served.set(tier, await serveTier(app, tier));
    const total = opts.runs * tasks.length * opts.models.length * opts.tiers.length;
    let n = 0;
    for (let run = 1; run <= opts.runs; run++)
      for (const task of tasks)
        for (const model of opts.models)
          for (const tier of opts.tiers) {
            const label = `[${++n}/${total}] ${model} ${tier} ${task.id} run ${run}`;
            if (done.has(`${model},${tier},${task.id},${run}`)) continue;
            process.stderr.write(`${label} ...\n`);
            const row = await runOne(app, task, tier, model, run, served.get(tier)?.url ?? 'http://localhost', opts, outDir);
            if (!row) continue;
            appendFileSync(csv, RUN_COLUMNS.map(c => csvCell(row[c])).join(',') + '\n');
            process.stderr.write(`${label} pass=${row.pass} done=${row.claimed_done} tools=${row.tool_calls} $${Number(row.cost_usd).toFixed(3)}\n`);
          }
  } finally {
    for (const s of served.values()) await s.stop();
  }
  process.stderr.write(`results: ${csv}\n`);
}

async function runOne(app: AppAdapter, task: Task, tier: Tier, model: string, run: number, url: string, opts: RunOptions, outDir: string): Promise<RunRecord | null> {
  const runId = `${tier}-${task.id}-${model}-r${run}-${Date.now().toString(36)}`;
  const runDir = join(outDir, runId);
  mkdirSync(runDir, { recursive: true });
  const setup = setupDriver(opts.driver, { runDir, runId, viewport: { width: 1280, height: 800 } });
  const prompt = buildPrompt(task, url) + setup.promptSuffix;
  const budget = opts.maxBudgetUsd * (CLI_PRICE_FACTOR[model] ?? 1);
  // --setting-sources '' keeps the operator's hooks, plugins and CLAUDE.md out of the agent's context.
  const args = [...setup.args, '--no-chrome', '--disable-slash-commands', '--setting-sources', '', '--permission-mode',
    'dontAsk', '--no-session-persistence', '--model', model, '--max-budget-usd', String(budget)];
  writeFileSync(join(runDir, 'prompt.txt'), prompt);
  writeFileSync(join(runDir, 'command.json'), JSON.stringify({ cmd: 'claude', args: ['-p', '<prompt.txt>', ...args], env: setup.env }, null, 2));
  if (opts.dryRun) return null;

  const seed = await app.seed();
  writeFileSync(join(runDir, 'seed.json'), JSON.stringify(seed, null, 2));
  let result: ClaudeRun;
  try {
    result = await runClaude(prompt, args, setup.env, opts.timeoutMin * 60_000);
  } finally {
    await setup.cleanup?.();
  }
  writeFileSync(join(runDir, 'transcript.jsonl'), result.transcript);
  const m = parseStreamJson(result.transcript);
  // An error before the agent did anything (expired login, network) is not a task failure.
  if (m.isError && m.toolCalls === 0 && m.outputTokens === 0) throw new Error(`claude failed before acting (${runDir}): ${m.finalText}`);
  const grade = await task.grade(seed, m.finalText);
  const claimed = claimedDone(m.finalText);
  writeFileSync(join(runDir, 'grade.json'), JSON.stringify({ ...grade, claimed, metrics: m }, null, 2));
  const rate = RATES[model];
  return {
    model, tier, task: task.id, run, pass: grade.pass, claimed_done: claimed, claim_correct: claimed === grade.pass,
    tool_calls: m.toolCalls, browser_tool_calls: m.browserToolCalls, screenshots: m.screenshots,
    input_tokens: m.inputTokens, output_tokens: m.outputTokens, cache_read_tokens: m.cacheReadTokens,
    cache_creation_tokens: m.cacheCreationTokens, cost_usd: rate ? repriceTranscript(result.transcript, rate) : m.costUsd,
    wall_ms: result.wallMs, turns: m.turns, exit_code: result.exitCode, timed_out: result.timedOut,
    timestamp: new Date().toISOString(), fail_reasons: grade.reasons.join(' | '),
  };
}
