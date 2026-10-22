#!/usr/bin/env node
// Merge the ax-tiers runner's CSVs into results/published/what-iff/runs.csv.
//   node apps/what-iff/export-runs.mjs <model>=<runner results.csv> ... > results/published/what-iff/runs.csv
//   e.g. claude-opus-5-5=tiers-a.csv claude-haiku-5-5=haiku-5-5.csv
// --driver adds the runner's driver column (playwright-mcp, webmcp, webmcp-soup) as `interface`.
// Adds model and tier columns and drops the local transcript path. Rows for models the `claude`
// CLI can't price (see RATES) are repriced from the transcript before the path is dropped.
import { readFileSync } from 'node:fs';

/** List prices per 1M tokens. Haiku 5.5 has a second rate card above a 100K-token prompt. */
const RATES = {
  'claude-haiku-5-5': prompt => (prompt > 100_000 ? { in: 0.5, out: 2.5 } : { in: 0.1, out: 0.5 }),
};
const TIER = { 3: 'div-soup', 0: 'wcag', 4: 'patterns' };
const COLUMNS = ['model', 'tier', 'ax_level', 'task', 'run', 'pass', 'claimed_done', 'claim_correct', 'tool_calls',
  'browser_tool_calls', 'screenshots', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_creation_tokens',
  'cost_usd', 'wall_ms', 'turns', 'exit_code', 'timed_out', 'timestamp', 'fail_reasons'];

/**
 * Cost of one run from its stream-json transcript. Stream events carry final input and cache counts
 * per request but partial output counts, so output comes from the result's total, split evenly across
 * requests to pick each request's rate card. Cache reads are 0.1x the input rate, 5-minute writes
 * 1.25x and 1-hour writes 2x. This reproduces the CLI's own figures for models it knows.
 */
export function reprice(transcriptPath, rateCard) {
  const events = readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  const result = events.find(e => e.type === 'result');
  const usageByRequest = new Map();
  for (const e of events) if (e.type === 'assistant' && e.message?.usage) usageByRequest.set(e.message.id, e.message.usage);
  const outputPerRequest = (Object.values(result?.modelUsage ?? {})[0]?.outputTokens ?? 0) / Math.max(usageByRequest.size, 1);
  let cost = 0;
  for (const u of usageByRequest.values()) {
    const read = u.cache_read_input_tokens ?? 0;
    const written = u.cache_creation_input_tokens ?? 0;
    const r = rateCard(u.input_tokens + read + written);
    const write5m = u.cache_creation?.ephemeral_5m_input_tokens ?? 0;
    const write1h = u.cache_creation?.ephemeral_1h_input_tokens ?? written - write5m;
    cost += (u.input_tokens * r.in + read * r.in * 0.1 + write5m * r.in * 1.25 + write1h * r.in * 2 + outputPerRequest * r.out) / 1e6;
  }
  return cost;
}

const withDriver = process.argv.includes('--driver');
if (withDriver) COLUMNS.splice(1, 0, 'interface');
const rows = [];
for (const arg of process.argv.slice(2).filter(a => a !== '--driver')) {
  const [model, path] = arg.split('=');
  const [header, ...lines] = readFileSync(path, 'utf8').trim().split('\n');
  const cols = header.split(',');
  for (const line of lines) {
    // fail_reasons (quoted when it holds commas) and transcript are the last two columns.
    const m = line.match(/^(.*?),("(?:[^"]|"")*"|[^,]*),([^,]*)$/);
    const lead = m[1].split(',');
    const row = Object.fromEntries(cols.slice(0, lead.length).map((c, i) => [c, lead[i]]));
    const failReasons = m[2].replace(/^"|"$/g, '').replace(/""/g, '"');
    if (RATES[model]) row.cost_usd = reprice(m[3], RATES[model]).toFixed(6);
    rows.push({ ...row, model, interface: row.driver, tier: TIER[row.level], ax_level: row.level, fail_reasons: failReasons.replace(/,/g, ';') });
  }
}
process.stdout.write([COLUMNS.join(','), ...rows.map(r => COLUMNS.map(c => r[c] ?? '').join(','))].join('\n') + '\n');
console.error(`${rows.length} rows`);
