import Anthropic, { APIConnectionError, APIError, APIUserAbortError } from '@anthropic-ai/sdk';
import { initLogger, wrapAnthropic } from 'braintrust';
import { logger } from '@/lib/logger';
import { getClaudeFallbackModelId, getClaudeModelId } from './constants';
import {
  EmptyModelResponseError,
  ModelRejectedError,
  OutputCapError,
  RefusalError,
  isDeterministicModelError,
} from './errors';
import { modelAcceptsTemperature, modelSupportsEffort } from './model-capabilities';
import { logAiUsage, normalizeAnthropicUsage } from './usage-log';

// ─── Configuration ──────────────────────────────────────────────────

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY ?? '';
const BRAINTRUST_API_KEY = process.env.BRAINTRUST_API_KEY ?? '';

// ─── Braintrust Observability ───────────────────────────────────────

if (BRAINTRUST_API_KEY) {
  initLogger({ projectName: 'poketools', apiKey: BRAINTRUST_API_KEY });
}

/**
 * Wall-clock deadline for the primary model attempt. The streaming routes run with
 * `maxDuration = 300`, so primary + fallback must stay well under that: 150 s + 90 s leaves
 * about a minute for loading the match, building the prompt and persisting the result.
 */
const PRIMARY_TIMEOUT_MS = 150_000;

/** Wall-clock deadline for the fallback model attempt. */
const FALLBACK_TIMEOUT_MS = 90_000;

/**
 * SDK-level retries per attempt (connection errors, 408/409/429/5xx before any byte of the
 * answer). The deadline above bounds them, since it aborts the whole attempt.
 */
const SDK_MAX_RETRIES = 1;

/** Default max tokens for Claude API (required parameter) */
const DEFAULT_MAX_TOKENS = 4096;

/** Sampling temperature for models that accept one (see `model-capabilities`). */
const TEMPERATURE = 0.2;

/** Usage-log label for a caller that names none. */
const DEFAULT_SURFACE = 'legacy';

// ─── Client Singleton ───────────────────────────────────────────────

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    if (!CLAUDE_API_KEY) {
      throw new Error('CLAUDE_API_KEY environment variable is required');
    }
    const anthropic = new Anthropic({ apiKey: CLAUDE_API_KEY });
    _client = BRAINTRUST_API_KEY ? wrapAnthropic(anthropic) : anthropic;
  }
  return _client;
}

// ─── Types ──────────────────────────────────────────────────────────

export interface AiCompletionResult {
  content: string;
  /** The model id the provider reports it ran (may be a dated id). */
  model: string;
  /** Fresh input + cache writes + cache reads. */
  prompt_tokens: number;
  completion_tokens: number;
  /** Why generation stopped (`end_turn`, `max_tokens`, ...); absent when the provider gave none. */
  stop_reason?: string | null;
  /** Refusal classifier category (`cyber`, `bio`), when the API named one. */
  stop_category?: string | null;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  /** True when the fallback model, not the requested one, produced this answer. */
  fallback_used?: boolean;
}

export interface AiCallOptions {
  /** Ask this model first instead of `CLAUDE_MODEL`. The fallback model is unchanged. */
  model?: string;
  /** `output_config.effort`; sent only to models that support it. */
  effort?: 'low' | 'medium' | 'high';
  /** Output cap. Takes precedence over the positional `maxTokens` of `completeStreaming`. */
  maxTokens?: number;
  /**
   * The caller parses the answer as JSON, so an answer cut off at `max_tokens` is useless:
   * throw `OutputCapError` instead of returning the partial text. Free-text callers leave this
   * off and get the partial text plus `stop_reason`.
   */
  jsonOutput?: boolean;
  /** Label for the usage log line. */
  surface?: string;
}

interface ResolvedCall {
  system: string;
  user: string;
  maxTokens: number;
  effort?: AiCallOptions['effort'];
  jsonOutput: boolean;
  surface: string;
}

// ─── Error classification ───────────────────────────────────────────

/** `error.type` values of a mid-stream SSE `error` event that a later attempt can survive. */
const TRANSIENT_STREAM_ERROR_TYPES = new Set([
  'overloaded_error',
  'api_error',
  'rate_limit_error',
  'timeout_error',
]);

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

/**
 * Whether a failure of one attempt justifies asking the fallback model: connection errors, our
 * own deadline, 408/409/429, 5xx (including 529) and mid-stream SSE error events, plus an empty
 * answer. Everything else (400/401/403/404/422, a refusal, a cut-off JSON answer, a bug) would
 * fail the same way again and is surfaced instead.
 *
 * Our deadline arrives as `APIUserAbortError`, an `APIError` that is not an
 * `APIConnectionError`, so it is listed explicitly. A mid-stream SSE `error` event has an
 * undefined `status` (`core/streaming.js`) and is told apart by `err.type`.
 */
function isTransientModelError(err: unknown): boolean {
  if (isDeterministicModelError(err)) return false;
  if (err instanceof EmptyModelResponseError) return true;
  if (err instanceof APIConnectionError || err instanceof APIUserAbortError) return true;
  if (err instanceof APIError) {
    if (typeof err.status === 'number') return isTransientStatus(err.status);
    return err.type !== null && TRANSIENT_STREAM_ERROR_TYPES.has(err.type);
  }
  return false;
}

/** Turn a non-transient provider rejection into a typed, user-safe error; pass the rest through. */
function surfaceError(err: unknown, model: string): unknown {
  if (err instanceof APIError && !isTransientModelError(err)) {
    logger.error('ai/client', `Model ${model} rejected the request`, {
      status: err.status ?? null,
      type: err.type ?? null,
    });
    return new ModelRejectedError(model, err.status ?? null, err.type ?? null, err);
  }
  return err;
}

function describeError(err: unknown): string {
  if (err instanceof APIError) {
    return `${err.name} (status ${err.status ?? 'none'}, type ${err.type ?? 'none'})`;
  }
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

// ─── Request building ───────────────────────────────────────────────

function buildParams(model: string, call: ResolvedCall): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: call.maxTokens,
    system: call.system,
    messages: [{ role: 'user', content: call.user }],
    // Models that reject sampling parameters get none; Sonnet 4.6 keeps 0.2.
    ...(modelAcceptsTemperature(model) && { temperature: TEMPERATURE }),
    ...(call.effort && modelSupportsEffort(model) && { output_config: { effort: call.effort } }),
  };
}

function resolveCall(
  systemPrompt: string,
  userPrompt: string,
  options: AiCallOptions | undefined,
  positionalMaxTokens?: number
): ResolvedCall {
  return {
    system: systemPrompt,
    user: userPrompt,
    maxTokens: options?.maxTokens ?? positionalMaxTokens ?? DEFAULT_MAX_TOKENS,
    effort: options?.effort,
    jsonOutput: options?.jsonOutput ?? false,
    surface: options?.surface ?? DEFAULT_SURFACE,
  };
}

/**
 * Check a finished message for the two stop reasons that change the outcome. Only these two are
 * branched on, and only when present: a missing `stop_reason` is never an error.
 */
function assertUsableStop(
  stopReason: string | null | undefined,
  category: string | null,
  model: string,
  call: ResolvedCall
): void {
  if (stopReason === 'refusal') {
    throw new RefusalError(model, category);
  }
  if (stopReason === 'max_tokens' && call.jsonOutput) {
    throw new OutputCapError(model, call.maxTokens);
  }
}

// ─── Completion ─────────────────────────────────────────────────────

/**
 * Call the LLM with a system prompt and user prompt.
 * Asks the default model first; on a transient failure (see `isTransientModelError`) asks the
 * fallback model once. Deterministic failures are thrown without a second paid call.
 */
export async function complete(
  systemPrompt: string,
  userPrompt: string,
  options?: AiCallOptions
): Promise<AiCompletionResult> {
  const client = getClient();
  const call = resolveCall(systemPrompt, userPrompt, options);
  const primaryModel = options?.model || getClaudeModelId();
  const fallbackModel = getClaudeFallbackModelId();

  try {
    return await callModel(client, primaryModel, call, PRIMARY_TIMEOUT_MS, false);
  } catch (primaryError) {
    console.error(`[ai/client] Primary model ${primaryModel} failed: ${describeError(primaryError)}`);
    if (!isTransientModelError(primaryError)) throw surfaceError(primaryError, primaryModel);
  }

  // Fallback model (throws on failure — caller handles)
  logger.warn('ai/client', `Falling back to ${fallbackModel}`);
  try {
    return await callModel(client, fallbackModel, call, FALLBACK_TIMEOUT_MS, true);
  } catch (fallbackError) {
    console.error(`[ai/client] Fallback model ${fallbackModel} failed: ${describeError(fallbackError)}`);
    throw surfaceError(fallbackError, fallbackModel);
  }
}

async function callModel(
  client: Anthropic,
  model: string,
  call: ResolvedCall,
  timeoutMs: number,
  isFallback: boolean
): Promise<AiCompletionResult> {
  const startedAt = Date.now();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);

  try {
    const response = await client.messages.create(buildParams(model, call), {
      signal: abort.signal,
      maxRetries: SDK_MAX_RETRIES,
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    assertUsableStop(response.stop_reason, response.stop_details?.category ?? null, model, call);

    if (!text) {
      throw new EmptyModelResponseError(model);
    }

    return finishResult(response, text, model, call, startedAt, isFallback);
  } finally {
    clearTimeout(timer);
  }
}

// ─── Streaming Completion ────────────────────────────────────────────

/**
 * Stream-based completion that calls the LLM with streaming enabled.
 * Calls `onChunk` for each stream event so the caller can emit heartbeats. Each attempt has an
 * absolute wall-clock deadline (an `AbortSignal` handed to the SDK), so a stalled stream ends in
 * a thrown error, never in a partial success.
 *
 * Asks the fallback model once on a transient failure of the primary; there is no third,
 * blocking attempt. `maxTokens` is the legacy positional cap; `options.maxTokens` wins when both
 * are given.
 */
export async function completeStreaming(
  systemPrompt: string,
  userPrompt: string,
  onChunk?: () => void,
  maxTokens?: number,
  options?: AiCallOptions
): Promise<AiCompletionResult> {
  const client = getClient();
  const call = resolveCall(systemPrompt, userPrompt, options, maxTokens);
  const primaryModel = options?.model || getClaudeModelId();
  const fallbackModel = getClaudeFallbackModelId();

  try {
    return await callModelStreaming(client, primaryModel, call, PRIMARY_TIMEOUT_MS, false, onChunk);
  } catch (primaryError) {
    console.error(`[ai/client] Primary streaming model ${primaryModel} failed: ${describeError(primaryError)}`);
    if (!isTransientModelError(primaryError)) throw surfaceError(primaryError, primaryModel);
  }

  // Fallback model (throws on failure — caller handles)
  logger.warn('ai/client', `Falling back to ${fallbackModel} (streaming)`);
  try {
    return await callModelStreaming(client, fallbackModel, call, FALLBACK_TIMEOUT_MS, true, onChunk);
  } catch (fallbackError) {
    console.error(`[ai/client] Fallback streaming model ${fallbackModel} failed: ${describeError(fallbackError)}`);
    throw surfaceError(fallbackError, fallbackModel);
  }
}

async function callModelStreaming(
  client: Anthropic,
  model: string,
  call: ResolvedCall,
  timeoutMs: number,
  isFallback: boolean,
  onChunk?: () => void
): Promise<AiCompletionResult> {
  const startedAt = Date.now();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);

  try {
    // The SDK `timeout` option bounds only the wait for response headers; the signal is the
    // real deadline for the whole attempt.
    const stream = client.messages.stream(buildParams(model, call), {
      signal: abort.signal,
      maxRetries: SDK_MAX_RETRIES,
    });

    let content = '';

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        content += event.delta.text;
      }

      onChunk?.();
    }

    // The SDK iterator ends quietly when the signal aborts between two events, so a partial
    // answer could look like a finished one. Check the deadline explicitly.
    if (abort.signal.aborted) {
      logger.warn('ai/client', `Model ${model} exceeded ${timeoutMs / 1000}s wall time — aborted`);
      throw new APIUserAbortError({ message: `Model ${model} exceeded its ${timeoutMs / 1000}s deadline` });
    }

    // Read the final message before judging the text: the stop reason decides whether the
    // text is an answer at all.
    const finalMessage = await stream.finalMessage();
    assertUsableStop(finalMessage.stop_reason, finalMessage.stop_details?.category ?? null, model, call);

    if (!content) {
      throw new EmptyModelResponseError(model, 'Empty streaming response');
    }

    return finishResult(finalMessage, content, model, call, startedAt, isFallback);
  } finally {
    clearTimeout(timer);
  }
}

function finishResult(
  message: Pick<Anthropic.Message, 'model' | 'usage' | 'stop_reason'> & { stop_details?: Anthropic.RefusalStopDetails | null },
  content: string,
  requestedModel: string,
  call: ResolvedCall,
  startedAt: number,
  isFallback: boolean
): AiCompletionResult {
  const usage = normalizeAnthropicUsage(message.usage);
  const result: AiCompletionResult = {
    content,
    model: message.model,
    prompt_tokens: usage.promptTokens,
    completion_tokens: usage.completionTokens,
    stop_reason: message.stop_reason ?? null,
    stop_category: message.stop_details?.category ?? null,
    cache_creation_input_tokens: usage.cacheWriteTokens,
    cache_read_input_tokens: usage.cacheReadTokens,
    fallback_used: isFallback,
  };
  logAiUsage({
    surface: call.surface,
    requestedModel,
    responseModel: message.model,
    inputTokens: usage.promptTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    outputTokens: usage.completionTokens,
    stopReason: result.stop_reason ?? null,
    ms: Date.now() - startedAt,
    fallbackUsed: isFallback,
  });
  return result;
}
