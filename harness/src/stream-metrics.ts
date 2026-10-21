/**
 * Turns one `claude -p --output-format stream-json --verbose` transcript into
 * the per-run numbers the demo reports.
 *
 * The stream is one JSON object per line. The shapes relied on here:
 *   - `{"type":"assistant","message":{"content":[...],"usage":{...}}}` — a model turn;
 *     `content` holds `tool_use` blocks (`name`, `input`) and `text` blocks.
 *   - `{"type":"result","usage":{...},"num_turns":N,"result":"...","is_error":bool,"total_cost_usd":X}`
 *     — the final summary, whose `usage` is the session total. Most input arrives as
 *     `cache_creation_input_tokens` / `cache_read_input_tokens`, not `input_tokens`, so report all four.
 * Anything unrecognised is ignored, so a newer CLI that adds event types does not break parsing.
 */

export interface RunMetrics {
  toolCalls: number;
  /** Browser-tool calls only (MCP `browser_*` tools, or `playwright-cli` Bash invocations). */
  browserToolCalls: number;
  screenshots: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  turns: number;
  /** `total_cost_usd` from the result event, when the CLI reports it (0 otherwise). */
  costUsd: number;
  /** Text of the last assistant message (or the result's `result` field). */
  finalText: string;
  isError: boolean;
  /** Tool names in call order, for debugging a run. */
  toolSequence: string[];
}

interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface ContentBlock {
  type?: string;
  name?: string;
  text?: string;
  input?: Record<string, unknown>;
}

interface StreamEvent {
  type?: string;
  message?: { id?: string; content?: ContentBlock[]; usage?: Usage };
  usage?: Usage;
  num_turns?: number;
  total_cost_usd?: number;
  result?: string;
  is_error?: boolean;
}

const SCREENSHOT_MCP_TOOL = /browser_take_screenshot$/;
const SCREENSHOT_CLI = /\bplaywright-cli\b[^\n]*\bscreenshot\b/;
const BROWSER_MCP_TOOL = /^mcp__.*__browser_/;
const BROWSER_CLI = /\bplaywright-cli\b/;

export function parseStreamJson(transcript: string): RunMetrics {
  const metrics: RunMetrics = {
    toolCalls: 0,
    browserToolCalls: 0,
    screenshots: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    turns: 0,
    costUsd: 0,
    finalText: '',
    isError: false,
    toolSequence: [],
  };

  // Per-message usage, keyed by message id: the CLI can emit one assistant
  // event per content block of the same message, each repeating its usage.
  const usageByMessage = new Map<string, Usage>();
  let resultUsage: Usage | null = null;

  for (const line of transcript.split('\n')) {
    const event = parseLine(line);
    if (!event) continue;

    if (event.type === 'assistant' && event.message) {
      const { content = [], usage, id } = event.message;
      if (usage) usageByMessage.set(id ?? `anon-${usageByMessage.size}`, usage);
      const text = content.filter(block => block.type === 'text' && block.text).map(block => block.text as string);
      if (text.length > 0) metrics.finalText = text.join('\n');
      for (const block of content) {
        if (block.type !== 'tool_use' || !block.name) continue;
        metrics.toolCalls++;
        metrics.toolSequence.push(block.name);
        const command = block.name === 'Bash' ? String(block.input?.['command'] ?? '') : '';
        if (BROWSER_MCP_TOOL.test(block.name) || BROWSER_CLI.test(command)) metrics.browserToolCalls++;
        if (SCREENSHOT_MCP_TOOL.test(block.name) || SCREENSHOT_CLI.test(command)) metrics.screenshots++;
      }
    }

    if (event.type === 'result') {
      resultUsage = event.usage ?? null;
      metrics.turns = event.num_turns ?? metrics.turns;
      metrics.isError = event.is_error === true;
      metrics.costUsd = typeof event.total_cost_usd === 'number' ? event.total_cost_usd : 0;
      if (typeof event.result === 'string' && event.result) metrics.finalText = event.result;
    }
  }

  // Prefer the result's session total; fall back to summing per-message usage
  // when the run was cut off before a result event (timeout, crash).
  const totals = resultUsage ? [resultUsage] : [...usageByMessage.values()];
  for (const usage of totals) {
    metrics.inputTokens += usage.input_tokens ?? 0;
    metrics.outputTokens += usage.output_tokens ?? 0;
    metrics.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
    metrics.cacheCreationTokens += usage.cache_creation_input_tokens ?? 0;
  }
  if (!resultUsage) metrics.turns = usageByMessage.size;
  return metrics;
}

function parseLine(line: string): StreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    return JSON.parse(trimmed) as StreamEvent;
  } catch {
    return null;
  }
}
