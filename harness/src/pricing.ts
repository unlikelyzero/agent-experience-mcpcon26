/**
 * List prices for models the `claude` CLI can't price. CLI 2.1.292 reports Opus 5.5 rates for
 * Claude Haiku 5.5 (costBasis "unknown"), about 40x too high, which also makes --max-budget-usd
 * stop Haiku 5.5 runs early. Every other model's `total_cost_usd` is used as reported.
 */
import { readFileSync } from 'node:fs';

type RateCard = (promptTokens: number) => { in: number; out: number };

/** Per 1M tokens. Haiku 5.5 has a second card above a 100K-token prompt. */
export const RATES: Record<string, RateCard> = {
  'claude-haiku-5-5': prompt => (prompt > 100_000 ? { in: 0.5, out: 2.5 } : { in: 0.1, out: 0.5 }),
};

/** How much the CLI overstates a model's cost; scales --max-budget-usd so the cap means real dollars. */
export const CLI_PRICE_FACTOR: Record<string, number> = { 'claude-haiku-5-5': 40 };

/**
 * Cost of one run from its stream-json transcript. Stream events carry final input and cache counts
 * per request but partial output counts, so output comes from the result's total, split evenly across
 * requests to pick each request's rate card. Cache reads are 0.1x the input rate, 5-minute writes
 * 1.25x and 1-hour writes 2x. This reproduces the CLI's own figures for models it knows.
 */
export function repriceTranscript(transcript: string, rateCard: RateCard): number {
  const events = transcript.split('\n').filter(Boolean).map(line => JSON.parse(line));
  const result = events.find(e => e.type === 'result');
  const usageByRequest = new Map<string, any>();
  for (const e of events) if (e.type === 'assistant' && e.message?.usage) usageByRequest.set(e.message.id, e.message.usage);
  const outputPerRequest = ((Object.values(result?.modelUsage ?? {})[0] as any)?.outputTokens ?? 0) / Math.max(usageByRequest.size, 1);
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

export const repriceFile = (path: string, rateCard: RateCard) => repriceTranscript(readFileSync(path, 'utf8'), rateCard);
