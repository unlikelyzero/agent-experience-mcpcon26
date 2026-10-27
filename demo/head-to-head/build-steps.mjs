// node build-steps.mjs <runDir> <out.json>
// Turns a recorded run (transcript.jsonl + line-times.json + grade.json) into a step log whose
// times are seconds into the browser video. The video starts when the MCP server opens the
// browser, i.e. at the agent's first browser tool call, so that call is t = 0.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, out] = process.argv.slice(2);
const lines = readFileSync(join(dir, 'transcript.jsonl'), 'utf8').split('\n').filter(Boolean);
const times = JSON.parse(readFileSync(join(dir, 'line-times.json'), 'utf8'));
const grade = JSON.parse(readFileSync(join(dir, 'grade.json'), 'utf8'));
// The seeded login appears in tool arguments; the step log shows placeholders instead.
const prompt = readFileSync(join(dir, 'prompt.txt'), 'utf8');
const secrets = [[/username "([^"]+)"/, '‹username›'], [/password "([^"]+)"/, '‹password›']]
  .map(([re, label]) => [prompt.match(re)?.[1], label]).filter(([v]) => v);
// Memory ids are UUIDs; their first block is enough to tell them apart on a slide.
const redact = text => secrets.reduce((t, [v, label]) => t.split(v).join(label), text).replace(/\b([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, '$1…');

const clip = (s, n = 90) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
// ref -> 'role "name"' from the accessibility snapshots the agent has read so far.
const refs = new Map();
// ref -> the lines of the latest tool result that showed it, for the tree excerpt around an action.
const seen = new Map();
function learnRefs(text) {
  for (const m of text.matchAll(/-\s+([a-z]+)(?:\s+"([^"]*)")?[^\n]*?\[ref=([a-z0-9]+)\]/g))
    refs.set(m[3], m[2] ? `${m[1]} “${clip(m[2], 50)}”` : `${m[1]} (no name)`);
  const lines = text.split('\n');
  lines.forEach((l, i) => { const m = l.match(/\[ref=([a-z0-9]+)\]/); if (m) seen.set(m[1], { lines, i }); });
}
// A few tree lines around the acted-on ref, dedented, without ref/cursor noise; `hit` is its row.
function excerpt(ref, before = 5, after = 4) {
  const at = seen.get(ref);
  if (!at) return undefined;
  const isTree = l => /^\s*- /.test(l);
  let a = at.i, b = at.i;
  while (a > 0 && at.i - a < before && isTree(at.lines[a - 1])) a--;
  while (b < at.lines.length - 1 && b - at.i < after && isTree(at.lines[b + 1])) b++;
  const rows = at.lines.slice(a, b + 1);
  const pad = Math.min(...rows.map(l => l.match(/^\s*/)[0].length));
  return { lines: rows.map(l => clip(l.slice(pad).replace(/ \[(ref=[a-z0-9]+|cursor=pointer)\]/g, ''), 64)), hit: at.i - a };
}
const refOf = input => input.target ?? input.ref ?? input.fields?.[0]?.target ?? input.fields?.[0]?.ref;
function describe(name, input) {
  const tool = name.replace('mcp__playwright__browser_', '');
  const ref = input.target ?? input.ref;
  const target = input.element ? `“${clip(input.element, 60)}”` : ref ? (refs.get(ref) ?? `ref ${ref}`) : '';
  switch (tool) {
    case 'navigate': return ['navigate', new URL(input.url).pathname + new URL(input.url).search];
    case 'snapshot': return ['read', 'accessibility tree'];
    case 'take_screenshot': return ['screenshot', 'falls back to pixels'];
    case 'click': return ['click', target];
    case 'type': return ['type', `“${clip(input.text ?? '', 40)}” into ${target}`];
    case 'fill_form': return ['fill', `${(input.fields ?? []).length} fields`];
    case 'select_option': return ['select', `${target} → ${(input.values ?? []).join(', ')}`];
    case 'press_key': return ['key', input.key];
    case 'hover': return ['hover', target];
    case 'evaluate': return ['script', clip((input.function ?? '').replace(/\s+/g, ' '), 70)];
    case 'run_code_unsafe': return ['code', clip((input.code ?? '').replace(/\s+/g, ' ').replace(/fill\('[^']*'\)/g, "fill('…')"), 70)];
    case 'find': return ['find', input.regex ?? input.text ?? ''];
    case 'wait_for': return ['wait', input.text ? `for “${clip(input.text, 40)}”` : `${input.time ?? ''}s`];
    default: return [tool, target];
  }
}

const steps = [];
const webmcpIds = new Set();
let t0 = null;
lines.forEach((line, i) => {
  const e = JSON.parse(line);
  if (e.type === 'user') {
    for (const c of e.message?.content ?? []) {
      for (const part of [].concat(c.content ?? [])) if (typeof part?.text === 'string') learnRefs(part.text);
      // WebMCP results are short and are the whole story, so they join the log.
      if (c.type === 'tool_result' && webmcpIds.has(c.tool_use_id)) {
        const text = [].concat(c.content ?? []).map(x => (typeof x === 'string' ? x : x.text ?? '')).join('');
        const error = c.is_error || /^(page\.evaluate: )?Error\b/.test(text);
        steps.push({ t: (times[i] ?? 0) / 1000, kind: error ? 'warn' : 'result', verb: error ? 'error' : 'returns',
          detail: clip(redact(text.replace(/^page\.evaluate: /, '').replace(/\s+at .*$/s, '').replace(/\s+/g, ' ')), 110) });
      }
    }
    return;
  }
  if (e.type !== 'assistant') return;
  const t = (times[i] ?? 0) / 1000;
  for (const c of e.message.content ?? []) {
    if (c.type === 'tool_use' && c.name.startsWith('mcp__webmcp__')) {
      // The WebMCP server opens the page when the session starts, so the video starts with the run.
      if (t0 === null) t0 = (times[0] ?? 0) / 1000;
      webmcpIds.add(c.id);
      steps.push({ t, kind: 'tool', verb: c.name.replace('mcp__webmcp__', ''), detail: clip(redact(JSON.stringify(c.input ?? {})), 110) });
    } else if (c.type === 'tool_use' && c.name.startsWith('mcp__playwright__browser_')) {
      if (t0 === null) t0 = t;
      const [verb, detail] = describe(c.name, c.input ?? {});
      const ref = refOf(c.input ?? {});
      steps.push({ t, kind: verb === 'screenshot' ? 'warn' : 'tool', verb, detail, ...(ref && excerpt(ref) ? { tree: excerpt(ref) } : {}) });
    } else if (c.type === 'text' && c.text.trim()) {
      steps.push({ t, kind: 'say', verb: 'says', detail: clip(c.text.trim().replace(/\s+/g, ' '), 160) });
    } else if (c.type === 'thinking' && c.thinking?.trim()) {
      steps.push({ t, kind: 'think', verb: 'thinks', detail: clip(c.thinking.trim().replace(/\s+/g, ' '), 160) });
    }
  }
});
// Optional: node build-steps.mjs <runDir> <out.json> '<substring>' '<note>' flags the matching step.
const [flag, note] = process.argv.slice(4);
if (flag) for (const s of steps) if (s.kind === 'tool' && s.detail.includes(flag)) { s.kind = 'bad'; s.detail += ` (${note})`; }
const end = (times.at(-1) ?? 0) / 1000;
for (const s of steps) s.t = Math.max(0, +(s.t - (t0 ?? 0)).toFixed(2));
const verdict = grade.pass
  ? { pass: true, text: 'Passed. Checked against the app\'s data, not the agent\'s word.' }
  : { pass: false, text: `Failed. ${grade.reasons.map(r => r.replace(/^"(.+)": starred changed \(false -> true\)$/, 'It also starred an unrelated memory, “$1”.').replace(/^target was deleted$/, 'It deleted the memory it was meant to edit.').replace(/^target still says (.+)$/, 'The memory still says $1.').replace(/^target does not say .+$/, '')).filter(Boolean).join(' ')}${grade.claimed ? ' It still reported the task complete.' : ''}` };
writeFileSync(out, JSON.stringify({ steps, verdict, end: +(end - (t0 ?? 0)).toFixed(2), toolCalls: grade.metrics.toolCalls, tokens: grade.metrics.inputTokens + grade.metrics.outputTokens + grade.metrics.cacheReadTokens + grade.metrics.cacheCreationTokens }, null, 1));
console.log(`${steps.length} steps, ${end - t0 | 0}s, pass=${grade.pass}`);
