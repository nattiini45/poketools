/**
 * Prices of the models the AI flow eval can run (USD per million tokens), and the cost of one call.
 *
 * A call's cost is computed from the usage the provider reports: fresh input at the input price,
 * cache reads and 5-minute cache writes at their own prices, and the output (which includes any
 * thinking) at the output price. Only models in this table can run: the `--max-cost-usd` cap is
 * meaningless for a model the eval cannot price, so an unknown id is refused instead of guessed.
 */

export interface PriceRow {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  /** 5-minute cache write. */
  cacheWritePerMTok: number;
}

const PRICES: Readonly<Record<string, PriceRow>> = {
  // Sonnet 5.5: $2 in / $10 out, cache read $0.20, 5m write $2.50.
  'claude-sonnet-5-5': { inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.2, cacheWritePerMTok: 2.5 },
  // Haiku 5.5 (prompts up to 100K tokens): $0.10 in / $0.50 out. Cache prices follow the usual
  // 0.1x read and 1.25x write multipliers; the flows never reach the cache floor, so they stay 0.
  'claude-haiku-5-5': { inputPerMTok: 0.1, outputPerMTok: 0.5, cacheReadPerMTok: 0.01, cacheWritePerMTok: 0.125 },
  // The previous defaults, for comparison runs.
  'claude-sonnet-4-6': { inputPerMTok: 3, outputPerMTok: 15, cacheReadPerMTok: 0.3, cacheWritePerMTok: 3.75 },
  'claude-haiku-4-5': { inputPerMTok: 1, outputPerMTok: 5, cacheReadPerMTok: 0.1, cacheWritePerMTok: 1.25 },
};

/** `claude-sonnet-5-5-20261001` -> `claude-sonnet-5-5`. */
export function baseModelId(model: string): string {
  return model.replace(/-\d{8}$/, '');
}

/** The price row of `model` (a dated id counts as its base id), or null when the eval cannot price it. */
export function priceOf(model: string): PriceRow | null {
  return PRICES[baseModelId(model)] ?? null;
}

export function pricedModels(): string[] {
  return Object.keys(PRICES);
}

export interface CallUsage {
  /** Fresh input + cache writes + cache reads (what `prompt_tokens` holds). */
  promptTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Output tokens, thinking included. */
  completionTokens: number;
}

/** USD cost of one call at `model`'s prices; null when the model has no price row. */
export function callCostUsd(model: string, usage: CallUsage): number | null {
  const price = priceOf(model);
  if (!price) return null;
  const fresh = Math.max(0, usage.promptTokens - usage.cacheReadTokens - usage.cacheWriteTokens);
  return (
    (fresh * price.inputPerMTok +
      usage.cacheReadTokens * price.cacheReadPerMTok +
      usage.cacheWriteTokens * price.cacheWritePerMTok +
      usage.completionTokens * price.outputPerMTok) /
    1_000_000
  );
}

/**
 * The most one call to `model` can cost: the whole prompt at the dearest input rate (a cache write
 * bills above fresh input) plus a full `maxTokens` of output. The cost cap reserves this before a
 * call starts, so it can never be exceeded.
 */
export function worstCaseCostUsd(model: string, promptTokensEstimate: number, maxTokens: number): number {
  const price = priceOf(model);
  if (!price) throw new Error(`no price for model ${model}`);
  const inputRate = Math.max(price.inputPerMTok, price.cacheWritePerMTok);
  return (promptTokensEstimate * inputRate + maxTokens * price.outputPerMTok) / 1_000_000;
}

/** Rough prompt size. Deliberately on the high side (about 3 characters per token for the 5.x tokenizer). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}
