import { logger } from '@/lib/logger';

/**
 * One counts-only usage record per model generation, shared by the raw-SDK client and the Kale
 * provider. It is the only telemetry the streaming path has (the Braintrust wrapper proxies
 * `messages.create` alone), and it never carries prompt text, model output or user data.
 */
export interface AiUsageRecord {
  /** Where the call came from (`match-analysis`, `slot-coach`, `kale`, ...). */
  surface: string;
  /** The model id the call asked for. */
  requestedModel: string;
  /** The model id the provider reports it ran. */
  responseModel: string;
  /** Total prompt tokens: fresh input plus cache writes plus cache reads. */
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  stopReason: string | null;
  /** Wall time of the successful attempt. */
  ms: number;
  /** True when a fallback model, not the requested one, produced the answer. */
  fallbackUsed: boolean;
}

/** Anthropic `usage` fields (`number | null` in the SDK types: absent when caching is unused). */
export interface AnthropicUsageFields {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export interface NormalizedUsage {
  /** Fresh input + cache writes + cache reads. */
  promptTokens: number;
  completionTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
}

/**
 * Sum an Anthropic `usage` into the prompt-token total the `prompt_tokens` columns store.
 * `input_tokens` excludes cached tokens, so the cache fields are added; each is `?? 0`
 * because the SDK types them `number | null` (a missing value would otherwise make NaN).
 */
export function normalizeAnthropicUsage(usage: AnthropicUsageFields): NormalizedUsage {
  const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0;
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
  return {
    promptTokens: (usage.input_tokens ?? 0) + cacheWriteTokens + cacheReadTokens,
    completionTokens: usage.output_tokens ?? 0,
    cacheWriteTokens,
    cacheReadTokens,
  };
}

/** The AI SDK `LanguageModelUsage` fields the Kale provider reads. */
export interface AiSdkUsageFields {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  inputTokenDetails?:
    | {
        cacheReadTokens?: number | undefined;
        cacheWriteTokens?: number | undefined;
      }
    | undefined;
}

/**
 * Normalise an AI SDK usage. `inputTokens` is already the total (cache reads and writes
 * included); the details only split it out.
 */
export function normalizeAiSdkUsage(usage: AiSdkUsageFields | undefined): NormalizedUsage {
  return {
    promptTokens: usage?.inputTokens ?? 0,
    completionTokens: usage?.outputTokens ?? 0,
    cacheWriteTokens: usage?.inputTokenDetails?.cacheWriteTokens ?? 0,
    cacheReadTokens: usage?.inputTokenDetails?.cacheReadTokens ?? 0,
  };
}

/** Emit one counts-only `logger.info` line for a finished generation. */
export function logAiUsage(record: AiUsageRecord): void {
  logger.info('ai/usage', 'generation', {
    surface: record.surface,
    requested_model: record.requestedModel,
    response_model: record.responseModel,
    input_tokens: record.inputTokens,
    cache_read_tokens: record.cacheReadTokens,
    cache_write_tokens: record.cacheWriteTokens,
    output_tokens: record.outputTokens,
    stop_reason: record.stopReason,
    ms: record.ms,
    fallback_used: record.fallbackUsed,
  });
}
