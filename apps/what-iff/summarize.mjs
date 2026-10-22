#!/usr/bin/env node
// Per-model x tier tables from results/published/what-iff/runs.csv (Markdown on stdout).
//   node apps/what-iff/summarize.mjs [runs.csv | interfaces.csv]
// T4 is reported separately: it fails at every tier because one target memory is scoped to a thread
// and never appears in the Archived view, so it measures discoverability, not accessibility.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const path = process.argv[2] ?? fileURLToPath(new URL('../../results/published/what-iff/runs.csv', import.meta.url));
const [header, ...lines] = readFileSync(path, 'utf8').trim().split('\n');
const cols = header.split(',');
// fail_reasons is the last column and may contain commas, so split only the leading columns.
const runs = lines.map(line => {
  const cells = line.split(',');
  const row = Object.fromEntries(cols.slice(0, -1).map((c, i) => [c, cells[i]]));
  row.fail_reasons = cells.slice(cols.length - 1).join(',');
  return row;
});

// Rows group by model, and by interface too when the CSV has one (interfaces.csv).
const groupOf = r => (r.interface ? `${r.model} · ${r.interface}` : r.model);
const MODELS = [...new Set(runs.map(groupOf))];
const TIERS = ['div-soup', 'wcag', 'patterns'];
const tokens = r => +r.input_tokens + +r.output_tokens + +r.cache_read_tokens + +r.cache_creation_tokens;
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const fmtTokens = n => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : `${Math.round(n / 1e3)}k`);

console.log('| Model | Tier | Pass | Mean tool calls | Mean screenshots | Tokens / success | $ / success | False "done" |');
console.log('|---|---|---|---|---|---|---|---|');
for (const model of MODELS)
  for (const tier of TIERS) {
    const rs = runs.filter(r => groupOf(r) === model && r.tier === tier && r.task !== 'T4');
    if (!rs.length) continue;
    const pass = rs.filter(r => r.pass === 'true').length;
    const spent = rs.reduce((s, r) => s + +r.cost_usd, 0);
    const falseDone = rs.filter(r => r.claimed_done === 'true' && r.pass === 'false').length;
    console.log(
      `| ${model} | ${tier} | ${pass}/${rs.length} | ${mean(rs.map(r => +r.tool_calls)).toFixed(1)} | ${mean(rs.map(r => +r.screenshots)).toFixed(1)} | ` +
        `${pass ? fmtTokens(rs.reduce((s, r) => s + tokens(r), 0) / pass) : '—'} | ${pass ? '$' + (spent / pass).toFixed(spent / pass < 0.1 ? 3 : 2) : '—'} | ${falseDone} |`,
    );
  }
const t4 = runs.filter(r => r.task === 'T4');
if (t4.length) console.log(`\nT4 (excluded above): ${t4.filter(r => r.pass === 'true').length}/${t4.length} passed across all tiers.`);
console.log(`\n${runs.length} runs, $${runs.reduce((s, r) => s + +r.cost_usd, 0).toFixed(2)} at list prices.`);
