/** `ax report`: per-model x tier tables from an `ax run` CSV (Markdown). See docs/DESIGN.md §6. */
import { readFileSync } from 'node:fs';
import { TIERS } from './types.js';

type Row = Record<string, string>;

export function readRuns(path: string): Row[] {
  const [header, ...lines] = readFileSync(path, 'utf8').trim().split('\n');
  const cols = header!.split(',');
  return lines.map(line => Object.fromEntries(line.split(',').map((v, i) => [cols[i], v])) as Row);
}

const tokens = (r: Row) => +r.input_tokens! + +r.output_tokens! + +r.cache_read_tokens! + +r.cache_creation_tokens!;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const fmtTokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : `${Math.round(n / 1e3)}k`);
const fmtUsd = (n: number) => `$${n.toFixed(n < 0.1 ? 3 : 2)}`;

/** `exclude` drops tasks that don't measure accessibility (e.g. what-iff T4). */
export function report(rows: Row[], exclude: string[] = []): string {
  const runs = rows.filter(r => !exclude.includes(r.task!));
  const out = ['| Model | Tier | Pass | Mean tool calls | Mean screenshots | Tokens / success | $ / success | False "done" |', '|---|---|---|---|---|---|---|---|'];
  for (const model of [...new Set(runs.map(r => r.model!))])
    for (const tier of TIERS) {
      const rs = runs.filter(r => r.model === model && r.tier === tier);
      if (!rs.length) continue;
      const pass = rs.filter(r => r.pass === 'true').length;
      const spent = rs.reduce((s, r) => s + +r.cost_usd!, 0);
      const falseDone = rs.filter(r => r.claimed_done === 'true' && r.pass === 'false').length;
      out.push(`| ${model} | ${tier} | ${pass}/${rs.length} | ${mean(rs.map(r => +r.tool_calls!)).toFixed(1)} | ${mean(rs.map(r => +r.screenshots!)).toFixed(1)} | ` +
        `${pass ? fmtTokens(rs.reduce((s, r) => s + tokens(r), 0) / pass) : '—'} | ${pass ? fmtUsd(spent / pass) : '—'} | ${falseDone} |`);
    }
  out.push('', '| Task | ' + TIERS.join(' | ') + ' |', '|---|' + TIERS.map(() => '---').join('|') + '|');
  for (const task of [...new Set(runs.map(r => r.task!))].sort())
    out.push(`| ${task} | ` + TIERS.map(t => {
      const rs = runs.filter(r => r.task === task && r.tier === t);
      return rs.length ? `${rs.filter(r => r.pass === 'true').length}/${rs.length}` : '—';
    }).join(' | ') + ' |');
  out.push('', `${runs.length} runs, ${fmtUsd(runs.reduce((s, r) => s + +r.cost_usd!, 0))} at list prices.`);
  return out.join('\n');
}
