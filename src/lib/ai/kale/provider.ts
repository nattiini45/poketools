import { generateText, streamText, type LanguageModel } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { ProviderOptions } from '@ai-sdk/provider-utils';
import type { AiCompletionResult } from '../client';
import { logger } from '@/lib/logger';
import { getClaudeModelId, getKaleModelId } from '../constants';
import {
  EmptyModelResponseError,
  ModelRejectedError,
  OutputCapError,
  RefusalError,
  isDeterministicModelError,
  isNetworkFailure,
} from '../errors';
import { logAiUsage, normalizeAiSdkUsage } from '../usage-log';

// ─── Configuration ──────────────────────────────────────────────────

type KaleProvider = 'anthropic' | 'openai' | 'openai-compatible';

function getProvider(): KaleProvider {
  const val = process.env.KALE_PROVIDER ?? 'anthropic';
  if (val === 'anthropic' || val === 'openai' || val === 'openai-compatible') return val;
  console.warn(`[kale/provider] Unknown KALE_PROVIDER "${val}", defaulting to "anthropic"`);
  return 'anthropic';
}

function getApiKey(): string {
  return process.env.KALE_API_KEY || process.env.CLAUDE_API_KEY || '';
}

function getModelId(): string {
  return getKaleModelId();
}

function getFallbackModelId(): string | null {
  return process.env.KALE_FALLBACK_MODEL || process.env.CLAUDE_FALLBACK_MODEL || null;
}

function getTimeoutMs(): number {
  return Number(process.env.KALE_TIMEOUT_MS) || 300_000;
}

function getFallbackTimeoutMs(): number {
  return Number(process.env.KALE_FALLBACK_TIMEOUT_MS) || 150_000;
}

function getTemperature(): number {
  return Number(process.env.KALE_TEMPERATURE) || 0.3;
}

function getMaxTokens(): number {
  return Number(process.env.KALE_MAX_TOKENS) || 4096;
}

/** Returns true if any Kale-compatible API key is configured */
export function isKaleConfigured(): boolean {
  return Boolean(getApiKey());
}

// ─── Debug Fetch ────────────────────────────────────────────────────

/**
 * Wraps global fetch to log the request body and full response body.
 * Enable with KALE_DEBUG=true. Logs are prefixed [kale/debug].
 */
function createDebugFetch(): typeof globalThis.fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const body = init?.body ? String(init.body).slice(0, 2000) : '(no body)';
    logger.info('kale/debug', `REQUEST ${init?.method ?? 'GET'} ${url}`, { body });

    const response = await globalThis.fetch(input, init);

    // Clone so we can read the body without consuming it
    const clone = response.clone();
    const text = await clone.text().catch(() => '(unreadable)');
    logger.info('kale/debug', `RESPONSE ${response.status} ${response.statusText}`, { body: text.slice(0, 3000) });

    return response;
  };
}

// ─── Model Factory ──────────────────────────────────────────────────

function buildModel(modelId: string): LanguageModel {
  const provider = getProvider();
  const apiKey = getApiKey();

  if (!apiKey) {
    throw new Error('No API key configured (set KALE_API_KEY or CLAUDE_API_KEY)');
  }

  switch (provider) {
    case 'anthropic':
      return createAnthropic({ apiKey })(modelId);

    case 'openai':
      return createOpenAI({ apiKey })(modelId);

    case 'openai-compatible': {
      const baseURL = process.env.KALE_BASE_URL;
      if (!baseURL) {
        throw new Error('KALE_BASE_URL is required when KALE_PROVIDER is "openai-compatible"');
      }
      // Use .chat() to force the Chat Completions API (/chat/completions)
      // with standard `messages` format. The default provider(modelId) call
      // uses the Responses API (/responses) which most compatible providers
      // either reject or mishandle (e.g. ModelArk routes all tokens to
      // reasoning_content, never producing text output).
      const debugFetch = process.env.KALE_DEBUG === 'true' ? createDebugFetch() : undefined;
      return createOpenAI({ apiKey, baseURL, name: 'openai-compat', fetch: debugFetch }).chat(modelId);
    }
  }
}

/**
 * Provider-specific options passed to generateText / streamText.
 *
 * For openai-compatible providers (nano-gpt, ModelArk/ByteDance, etc.) the
 * AI SDK auto-detects "reasoning models" by model ID prefix (o1, o3, gpt-5…)
 * and rewrites the request in ways these providers reject:
 *   - system role → "developer" role  (400: unknown role)
 *   - max_tokens → max_completion_tokens  (400: unknown parameter)
 *   - temperature stripped  (response quality tanks)
 *
 * We fix all three by passing forceReasoning: false and
 * systemMessageMode: 'system' via providerOptions.
 */
function getProviderOptions(): ProviderOptions | undefined {
  const provider = getProvider();
  if (provider === 'openai-compatible') {
    return {
      'openai-compat': {
        // Always use role:"system", never "developer"
        systemMessageMode: 'system' as const,
        // Prevent reasoning-model detection from rewriting max_tokens
        // and stripping temperature
        forceReasoning: false,
        // Models like ByteDance Seed 2.0 have a reasoning_effort system
        // that defaults to deep thinking — set to "none" so the model
        // outputs plain text instead of routing tokens to reasoning_content.
        // Override via KALE_REASONING_EFFORT if a specific model needs it.
        reasoningEffort: (process.env.KALE_REASONING_EFFORT ?? 'none') as 'none' | 'low' | 'medium' | 'high',
      },
    };
  }
  return undefined;
}

// ─── Targets ────────────────────────────────────────────────────────

/** One model a call can be sent to, with what the stop-reason checks need to know about it. */
interface KaleTarget {
  model: LanguageModel;
  modelId: string;
  /** True for the Anthropic API, where a `content-filter` finish means a refusal. */
  anthropic: boolean;
  /** True for every rung after the first: the answer comes from a fallback model. */
  fallback: boolean;
}

function getPrimaryTarget(): KaleTarget {
  const modelId = getModelId();
  return { model: buildModel(modelId), modelId, anthropic: getProvider() === 'anthropic', fallback: false };
}

function getFallbackTarget(): KaleTarget | null {
  const modelId = getFallbackModelId();
  return modelId
    ? { model: buildModel(modelId), modelId, anthropic: getProvider() === 'anthropic', fallback: true }
    : null;
}

// ─── Error classification ───────────────────────────────────────────

/** `error.type` values of a mid-stream provider `error` event that a later attempt can survive. */
const TRANSIENT_STREAM_ERROR_TYPES = new Set([
  'overloaded_error',
  'api_error',
  'rate_limit_error',
  'timeout_error',
]);

/** The wall-clock deadline of one attempt passed. Transient: the next rung may be faster. */
class KaleDeadlineError extends Error {
  constructor(modelId: string, timeoutMs: number) {
    super(`Model ${modelId} exceeded its ${timeoutMs / 1000}s deadline`);
    this.name = 'TimeoutError';
  }
}

interface ErrorFields {
  name?: unknown;
  statusCode?: unknown;
  status?: unknown;
  isRetryable?: unknown;
  type?: unknown;
  error?: { type?: unknown } | null;
}

function errorFields(err: unknown): ErrorFields {
  return typeof err === 'object' && err !== null ? (err as ErrorFields) : {};
}

function statusOf(err: unknown): number | null {
  const fields = errorFields(err);
  const status = typeof fields.statusCode === 'number' ? fields.statusCode : fields.status;
  return typeof status === 'number' ? status : null;
}

/** The provider's `error.type` of a mid-stream error event, or of an API error body. */
function providerTypeOf(err: unknown): string | null {
  const fields = errorFields(err);
  if (typeof fields.type === 'string') return fields.type;
  return typeof fields.error?.type === 'string' ? fields.error.type : null;
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

/**
 * Whether a failure of one attempt justifies the next rung of the ladder: our own deadline,
 * connection errors, 408/409/429/5xx, a mid-stream provider error event of a transient type, and
 * an empty answer. A 4xx, a refusal, a truncated answer and a bug would fail the same way again,
 * so they are surfaced instead.
 */
function isTransientKaleError(err: unknown): boolean {
  if (isDeterministicModelError(err)) return false;
  if (err instanceof EmptyModelResponseError || err instanceof KaleDeadlineError) return true;
  const fields = errorFields(err);
  if (fields.name === 'AbortError' || fields.name === 'TimeoutError') return true;
  // A body that dies mid-stream: undici's bare `TypeError('terminated')` reaches `onError` as is,
  // and a failed non-streaming body read arrives as an APICallError (status 200) wrapping it.
  if (isNetworkFailure(err)) return true;
  // An AI SDK APICallError knows whether a retry helps; a network failure has no status at all.
  if (fields.name === 'AI_APICallError' && fields.isRetryable === true) return true;
  const status = statusOf(err);
  if (status !== null) return isTransientStatus(status);
  if (fields.name === 'AI_APICallError') return false;
  const type = providerTypeOf(err);
  return type !== null && TRANSIENT_STREAM_ERROR_TYPES.has(type);
}

function errorSummary(err: unknown): string {
  const status = statusOf(err);
  const type = providerTypeOf(err);
  const base = err instanceof Error ? err.message : String(err);
  return `${base}${status !== null ? ` [${status}]` : ''}${type ? ` (${type})` : ''}`;
}

/** Surface a non-transient failure: typed errors as they are, a provider 4xx as a typed rejection. */
function surfaceKaleError(err: unknown, modelId: string): unknown {
  if (isDeterministicModelError(err)) return err;
  const status = statusOf(err);
  if (status !== null && status >= 400) {
    return new ModelRejectedError(modelId, status, providerTypeOf(err), err);
  }
  return err;
}

// ─── Stop reasons ───────────────────────────────────────────────────

/**
 * Judge how a finished call stopped. `length` is a cut-off answer (on this path it cannot be told
 * apart from context overflow, so no larger-cap retry is attempted): it throws, and the pipeline
 * routes a thrown error to the assembler's fallback text, which beats publishing half a sentence.
 * `content-filter` is a refusal on the Anthropic API only; on OpenAI-style providers it means a
 * moderation hit and keeps the old handling. Branch on the finish reason, not on `stopDetails`,
 * which can be absent on a refusal.
 */
function assertUsableFinish(
  target: KaleTarget,
  finishReason: string | undefined,
  providerMetadata: unknown,
  maxTokens: number
): void {
  if (finishReason === 'length') {
    throw new OutputCapError(target.modelId, maxTokens);
  }
  if (finishReason === 'content-filter' && target.anthropic) {
    throw new RefusalError(target.modelId, stopCategoryOf(providerMetadata));
  }
}

function stopCategoryOf(providerMetadata: unknown): string | null {
  const anthropic = (providerMetadata as { anthropic?: { stopDetails?: { category?: unknown } } } | undefined)
    ?.anthropic;
  const category = anthropic?.stopDetails?.category;
  return typeof category === 'string' ? category : null;
}

// ─── Fallback ladder ────────────────────────────────────────────────

type KaleCall = (target: KaleTarget, timeoutMs: number) => Promise<AiCompletionResult>;

/**
 * Primary model, then the configured fallback model, then (for a non-Anthropic primary provider)
 * Anthropic as a last resort. After a transient failure the next rung is tried. After a
 * non-transient one (a provider 4xx, a missing key or base URL) the ladder only carries on when
 * the Anthropic last resort is available, because that is a different provider and can still
 * answer; otherwise it throws at once, so one bad request costs one call, not five. A truncated
 * or refused answer is terminal everywhere: another model would get the same prompt.
 */
async function runLadder(mode: 'blocking' | 'streaming', call: KaleCall): Promise<AiCompletionResult> {
  const tag = mode === 'streaming' ? 'streaming ' : '';
  let lastError = 'unknown';

  // Last resort: if primary provider wasn't Anthropic and CLAUDE_API_KEY exists, try Anthropic
  // Set KALE_DISABLE_FALLBACK=true to skip this (useful during testing to avoid Anthropic costs)
  const claudeKey = process.env.CLAUDE_API_KEY;
  const fallbackDisabled = process.env.KALE_DISABLE_FALLBACK === 'true';
  const anthropicRescue = !fallbackDisabled && getProvider() !== 'anthropic' && Boolean(claudeKey);

  /** Decide after a failed rung: return to carry on with the next one, or throw. */
  function carryOnOrThrow(err: unknown, modelId: string): void {
    if (isTransientKaleError(err)) return;
    const terminal = err instanceof OutputCapError || err instanceof RefusalError;
    if (terminal || !anthropicRescue) throw surfaceKaleError(err, modelId);
  }

  // Primary model
  const primaryId = getModelId();
  try {
    return await call(getPrimaryTarget(), getTimeoutMs());
  } catch (primaryError) {
    lastError = errorSummary(primaryError);
    console.error(`[kale/provider] Primary ${tag}model (${getProvider()}/${primaryId}) failed: ${lastError}`);
    carryOnOrThrow(primaryError, primaryId);
  }

  // Explicit fallback model (same provider)
  const fallbackId = getFallbackModelId();
  if (fallbackId) {
    try {
      logger.warn('kale/provider', `Trying fallback model: ${fallbackId}${mode === 'streaming' ? ' (streaming)' : ''}`);
      return await call(getFallbackTarget()!, getFallbackTimeoutMs());
    } catch (fallbackError) {
      lastError = errorSummary(fallbackError);
      console.error(`[kale/provider] Fallback ${tag}model failed: ${lastError}`);
      carryOnOrThrow(fallbackError, fallbackId);
    }
  }

  if (anthropicRescue) {
    const claudeModel = getClaudeModelId();
    try {
      logger.warn('kale/provider', `Primary provider failed, falling back to Anthropic (${claudeModel})`);
      const anthropicModel = createAnthropic({ apiKey: claudeKey! })(claudeModel);
      return await call(
        { model: anthropicModel, modelId: claudeModel, anthropic: true, fallback: true },
        getFallbackTimeoutMs()
      );
    } catch (claudeError) {
      lastError = errorSummary(claudeError);
      console.error(`[kale/provider] Anthropic fallback also failed: ${lastError}`);
      if (!isTransientKaleError(claudeError)) throw surfaceKaleError(claudeError, claudeModel);
    }
  }

  throw new Error(`All Kale model attempts failed (${getProvider()}/${primaryId}): ${lastError}`);
}

// ─── Blocking Completion ────────────────────────────────────────────

/**
 * Generate text with the configured Kale model.
 * Tries the primary model, then the fallback ladder (see `runLadder`) on transient failures.
 * Returns the same AiCompletionResult shape used by the legacy client.
 */
export async function kaleGenerateText(
  systemPrompt: string,
  userPrompt: string,
  opts?: { maxTokens?: number; temperature?: number }
): Promise<AiCompletionResult> {
  const maxTokens = opts?.maxTokens ?? getMaxTokens();
  const temperature = opts?.temperature ?? getTemperature();
  const apiKey = getApiKey();

  if (!apiKey) {
    throw new Error(`No API key found. Set KALE_API_KEY or CLAUDE_API_KEY. Provider: ${getProvider()}, Model: ${getModelId()}`);
  }

  return runLadder('blocking', (target, timeoutMs) =>
    callGenerateText(target, systemPrompt, userPrompt, maxTokens, temperature, timeoutMs)
  );
}

async function callGenerateText(
  target: KaleTarget,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  temperature: number,
  timeoutMs: number
): Promise<AiCompletionResult> {
  const startedAt = Date.now();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);

  try {
    let result;
    try {
      result = await generateText({
        model: target.model,
        // Use top-level `system` — the SDK translates per-provider
        // (Anthropic system param, OpenAI system role, etc.)
        system: systemPrompt,
        messages: [
          { role: 'user', content: userPrompt },
        ],
        maxOutputTokens: maxTokens,
        temperature,
        maxRetries: 0,
        abortSignal: abort.signal,
        providerOptions: getProviderOptions(),
      });
    } catch (err) {
      if (abort.signal.aborted) throw new KaleDeadlineError(target.modelId, timeoutMs);
      throw err;
    }

    assertUsableFinish(target, result.finishReason, result.providerMetadata, maxTokens);

    if (!result.text) {
      // Log the full response shape so we can see what the provider actually returned
      const resp = result.response;
      const finishReason = result.finishReason;
      const reasoningText = result.reasoningText;
      console.error(
        `[kale/provider] Empty text from model.`,
        `finishReason=${finishReason}`,
        `modelId=${resp?.modelId ?? '?'}`,
        `inputTokens=${result.usage?.inputTokens ?? '?'}`,
        `outputTokens=${result.usage?.outputTokens ?? '?'}`,
        reasoningText ? `reasoningLength=${reasoningText.length}` : 'noReasoning',
      );

      // Some models (ByteDance Seed, DeepSeek) put output in reasoning
      // content instead of text when in "thinking" mode.
      if (reasoningText) {
        console.warn(`[kale/provider] No text content but found reasoning output (${reasoningText.length} chars), using as text`);
        return finishResult(target, reasoningText, result, startedAt);
      }

      throw new EmptyModelResponseError(
        target.modelId,
        `Empty response (finishReason=${finishReason}, outputTokens=${result.usage?.outputTokens ?? 0})`
      );
    }

    return finishResult(target, result.text, result, startedAt);
  } finally {
    clearTimeout(timer);
  }
}

/** The pieces of a finished `generateText` / `streamText` call that the result reads. */
interface FinishedCall {
  response?: { modelId?: string } | undefined;
  usage?: Parameters<typeof normalizeAiSdkUsage>[0];
  finishReason?: string | undefined;
  providerMetadata?: unknown;
}

function finishResult(
  target: KaleTarget,
  content: string,
  finished: FinishedCall,
  startedAt: number
): AiCompletionResult {
  const usage = normalizeAiSdkUsage(finished.usage);
  const responseModel = finished.response?.modelId ?? 'unknown';
  const stopReason = finished.finishReason ?? null;
  logAiUsage({
    surface: 'kale',
    requestedModel: target.modelId,
    responseModel,
    inputTokens: usage.promptTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    outputTokens: usage.completionTokens,
    stopReason,
    ms: Date.now() - startedAt,
    fallbackUsed: target.fallback,
  });
  return {
    content,
    model: responseModel,
    prompt_tokens: usage.promptTokens,
    completion_tokens: usage.completionTokens,
    stop_reason: stopReason,
    stop_category: stopCategoryOf(finished.providerMetadata),
    cache_creation_input_tokens: usage.cacheWriteTokens,
    cache_read_input_tokens: usage.cacheReadTokens,
    fallback_used: target.fallback,
  };
}

// ─── Streaming Completion ───────────────────────────────────────────

/**
 * Stream-based completion using the configured Kale model.
 * Calls `onChunk` for each content delta (for heartbeat emission).
 * Uses the same fallback ladder as `kaleGenerateText`; there is no blocking replay of a failed
 * stream.
 */
export async function kaleStreamText(
  systemPrompt: string,
  userPrompt: string,
  onChunk?: () => void,
  opts?: { maxTokens?: number; temperature?: number }
): Promise<AiCompletionResult> {
  const maxTokens = opts?.maxTokens ?? getMaxTokens();
  const temperature = opts?.temperature ?? getTemperature();

  return runLadder('streaming', (target, timeoutMs) =>
    callStreamText(target, systemPrompt, userPrompt, maxTokens, temperature, timeoutMs, onChunk)
  );
}

async function callStreamText(
  target: KaleTarget,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  temperature: number,
  timeoutMs: number,
  onChunk?: () => void
): Promise<AiCompletionResult> {
  const startedAt = Date.now();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  // `result.text` rejects with a generic "no output" error; the stream's own error (its status,
  // or a mid-stream provider error event) arrives here and decides how the ladder reacts.
  let streamError: unknown;

  try {
    const result = streamText({
      model: target.model,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userPrompt },
      ],
      maxOutputTokens: maxTokens,
      temperature,
      maxRetries: 0,
      abortSignal: abort.signal,
      onChunk: () => { onChunk?.(); },
      onError: ({ error }) => { streamError = error; },
      providerOptions: getProviderOptions(),
    });

    // Consume the stream to get the full text
    let text: string;
    try {
      text = await result.text;
    } catch (err) {
      if (abort.signal.aborted) throw new KaleDeadlineError(target.modelId, timeoutMs);
      throw streamError ?? err;
    }
    if (streamError !== undefined) throw streamError;

    const finishReason = await result.finishReason;
    const providerMetadata = await result.providerMetadata;
    assertUsableFinish(target, finishReason, providerMetadata, maxTokens);

    if (!text) {
      throw new EmptyModelResponseError(target.modelId, 'Empty streaming response');
    }

    const usage = await result.usage;
    const response = await result.response;

    return finishResult(target, text, { response, usage, finishReason, providerMetadata }, startedAt);
  } finally {
    clearTimeout(timer);
  }
}
