/**
 * Prices and estimates (plan 6.4 "Cost accounting", section 9). Money is whole micro-dollars, the unit of the usage
 * ledger: a price in dollars per million tokens is numerically the micro-dollars of one token.
 *
 * Sources: Opus 5.5 4 / 20 (input / output), cache read 0.20, cache write 5 m 5.00 and 1 h 8.00; Sonnet 5.5 2 / 10,
 * read 0.20, write 2.50 and 4.00; Haiku 5.5 0.10 / 0.50 (a published rate up to a 100K-token prompt). The Haiku cache
 * prices are NOT published: they are derived (read 0.1x, writes 1.25x and 2x the input price) and stay assumed.
 *
 * The table is also the allowlist of model ids the configuration accepts (`PRICED_MODEL_IDS`, used by `env.ts`): a new id
 * is added here together with its price row and a contract-test case. A conversation row can still pin an id that is not
 * in the table (it is never rejected after the fact); such a model is priced at the highest price of every column. A real
 * run reads the actual meters from the API response (`UsageMeters`); the table is only used to turn them into money and to
 * reserve before a call.
 */
import type { UsageMeters } from '../store/types';

export interface ModelPrice {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite5m: number;
  readonly cacheWrite1h: number;
}

/** Dollars per million tokens, keyed by model family prefix. */
const TABLE: ReadonlyArray<readonly [string, ModelPrice]> = [
  ['claude-opus-5-5', { input: 4, output: 20, cacheRead: 0.2, cacheWrite5m: 5, cacheWrite1h: 8 }],
  ['claude-sonnet-5-5', { input: 2, output: 10, cacheRead: 0.2, cacheWrite5m: 2.5, cacheWrite1h: 4 }],
  ['claude-haiku-5-5', { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite5m: 0.125, cacheWrite1h: 0.2 }],
];

/** The model ids the table prices, in table order. The configuration accepts these (and a dated form of each), nothing else. */
export const PRICED_MODEL_IDS: readonly string[] = TABLE.map(([id]) => id);

const HIGHEST: ModelPrice = TABLE.reduce<ModelPrice>(
  (max, [, price]) => ({
    input: Math.max(max.input, price.input),
    output: Math.max(max.output, price.output),
    cacheRead: Math.max(max.cacheRead, price.cacheRead),
    cacheWrite5m: Math.max(max.cacheWrite5m, price.cacheWrite5m),
    cacheWrite1h: Math.max(max.cacheWrite1h, price.cacheWrite1h),
  }),
  { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
);

/** The price of `model`; `known` is false when the table has no entry and the highest price is returned. */
export function priceOf(model: string): { price: ModelPrice; known: boolean } {
  const hit = TABLE.find(([prefix]) => model === prefix || model.startsWith(`${prefix}-`));
  return hit ? { price: hit[1], known: true } : { price: HIGHEST, known: false };
}

/** The real cost of a response, rounded up to a whole micro-dollar. */
export function costMicro(model: string, meters: UsageMeters): number {
  const { price } = priceOf(model);
  const total =
    meters.inputTokens * price.input +
    meters.cacheWrite5mTokens * price.cacheWrite5m +
    meters.cacheWrite1hTokens * price.cacheWrite1h +
    meters.cacheReadTokens * price.cacheRead +
    meters.outputTokens * price.output;
  return Math.max(0, Math.ceil(total));
}

/** Output tokens a reservation assumes for a step (thinking included); the settle replaces it with the real cost. */
export const RESERVE_OUTPUT_TOKENS = 8000;

/**
 * What to reserve before a call: the whole prompt at the dearest input price (a cold 1 h write, since a cache miss
 * after a human pause is the expensive case) plus an assumed answer. The overshoot past a cap is bounded by one call.
 */
export function estimateStepCostMicro(model: string, promptTokens: number, maxOutputTokens: number): number {
  const { price } = priceOf(model);
  const output = Math.min(maxOutputTokens, RESERVE_OUTPUT_TOKENS);
  return Math.max(1, Math.ceil(promptTokens * price.cacheWrite1h + output * price.output));
}

/** Bytes over 3.5, the same rule the registry uses for its per-phase tool budget. Deliberately a little high. */
export function estimateTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, 'utf8') / 3.5);
}

/**
 * The context window used for the "refuse a new turn at N% of the window" rule. Unverified for the 5.5 ids (spike S4
 * measures it; the research notes 1M), so it is the conservative 200k for every model unless the caller overrides.
 */
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000;

/** The most output tokens a step may produce: 32k for Opus, 16k for Sonnet and other models, 4k for Haiku (plan 3.4). */
export function maxOutputTokensFor(model: string): number {
  if (model.startsWith('claude-opus-')) return 32_000;
  if (model.startsWith('claude-haiku-')) return 4096;
  return 16_000;
}
