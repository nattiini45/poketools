import { generateText, streamText, type LanguageModel } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { ProviderOptions } from '@ai-sdk/provider-utils';
import type { AiCompletionResult } from '../client';
import { logger } from '@/lib/logger';
import { anthropicApiKey } from '../api-key';
import { getClaudeEffort, getClaudeFallbackModelId, getClaudeModelId } from '../constants';
import {
  AllModelsFailedError,
  EmptyModelResponseError,
  ModelRejectedError,
  OutputCapError,
  RefusalError,
  isDeterministicModelError,
  isNetworkFailure,
} from '../errors';
import { modelAcceptsTemperature, modelSupportsEffort } from '../model-capabilities';
import { logAiUsage, normalizeAiSdkUsage } from '../usage-log';
import { warnRemovedKaleSettings } from './removed-settings';

// ─── Configuration ──────────────────────────────────────────────────
//
// Kale uses Claude only, with the same model, fallback model and effort as every other text
// surface (`CLAUDE_MODEL`, `CLAUDE_FALLBACK_MODEL`, `CLAUDE_API_EFFORT`, `ANTHROPIC_API_KEY`). There is
// no Kale-specific model or provider setting.

function getApiKey(): string {
  return anthropicApiKey();
}

function getTimeoutMs(): number {
  return Number(process.env.KALE_TIMEOUT_MS) || 300_000;
}

function getFallbackTimeoutMs(): number {
  return Number(process.env.KALE_FALLBACK_TIMEOUT_MS) || 150_000;
}

/** Sampling temperature for models that accept one (see `model-capabilities`). */
const TEMPERATURE = 0.3;

function getMaxTokens(): number {
  return Number(process.env.KALE_MAX_TOKENS) || 4096;
}

/** Returns true if the Anthropic API key is configured */
export function isKaleConfigured(): boolean {
  warnRemovedKaleSettings();
  return Boolean(getApiKey());
}

// ─── Model Factory ──────────────────────────────────────────────────

function buildModel(modelId: string): LanguageModel {
  const apiKey = getApiKey();

  if (!apiKey) {
    throw new Error('No API key configured (set ANTHROPIC_API_KEY)');
  }

  return createAnthropic({ apiKey })(modelId);
}

/**
 * Per-model request options passed to generateText / streamText.
 *
 * `effort` goes only to models that support it (not Haiku 4.5). `thinking` is never set: the
 * 5.x models think adaptively by default, and `{ type: 'disabled' }` is rejected by Sonnet 5.5.
 * Temperature is likewise sent only to a model that accepts one.
 */
function getCallSettings(modelId: string): {
  temperature?: number;
  providerOptions?: ProviderOptions;
} {
  return {
    ...(modelAcceptsTemperature(modelId) && { temperature: TEMPERATURE }),
    ...(modelSupportsEffort(modelId) && { providerOptions: { anthropic: { effort: getClaudeEffort() } } }),
  };
}

// ─── Targets ────────────────────────────────────────────────────────

/** One model a call can be sent to, with what the stop-reason checks need to know about it. */
interface KaleTarget {
  model: LanguageModel;
  modelId: string;
  /** True for the fallback rung: the answer comes from the fallback model. */
  fallback: boolean;
}

function getPrimaryTarget(): KaleTarget {
  const modelId = getClaudeModelId();
  return { model: buildModel(modelId), modelId, fallback: false };
}

function getFallbackTarget(): KaleTarget {
  const modelId = getClaudeFallbackModelId();
  return { model: buildModel(modelId), modelId, fallback: true };
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
 * `content-filter` is a refusal. Branch on the finish reason, not on `stopDetails`, which can be
 * absent on a refusal.
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
  if (finishReason === 'content-filter') {
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
 * Primary model, then the fallback model. Only a transient failure (see `isTransientKaleError`)
 * moves on to the next rung; anything else is terminal, so one bad request costs one call, not
 * two. A truncated or refused answer is terminal too: another model would get the same prompt.
 */
async function runLadder(mode: 'blocking' | 'streaming', call: KaleCall): Promise<AiCompletionResult> {
  const tag = mode === 'streaming' ? 'streaming ' : '';
  warnRemovedKaleSettings();

  // Primary model
  const primaryId = getClaudeModelId();
  let primarySummary: string;
  try {
    return await call(getPrimaryTarget(), getTimeoutMs());
  } catch (primaryError) {
    primarySummary = errorSummary(primaryError);
    console.error(`[kale/provider] Primary ${tag}model (${primaryId}) failed: ${primarySummary}`);
    if (!isTransientKaleError(primaryError)) throw surfaceKaleError(primaryError, primaryId);
  }

  // Fallback model
  const fallbackId = getClaudeFallbackModelId();
  try {
    logger.warn('kale/provider', `Trying fallback model: ${fallbackId}${mode === 'streaming' ? ' (streaming)' : ''}`);
    return await call(getFallbackTarget(), getFallbackTimeoutMs());
  } catch (fallbackError) {
    const fallbackFailure = errorSummary(fallbackError);
    console.error(`[kale/provider] Fallback ${tag}model (${fallbackId}) failed: ${fallbackFailure}`);
    if (!isTransientKaleError(fallbackError)) throw surfaceKaleError(fallbackError, fallbackId);
    throw new AllModelsFailedError(
      [
        { model: primaryId, summary: primarySummary },
        { model: fallbackId, summary: fallbackFailure },
      ],
      fallbackError
    );
  }
}

// ─── Blocking Completion ────────────────────────────────────────────

/**
 * Generate text with the configured Claude model (`CLAUDE_MODEL`).
 * Tries the primary model, then the fallback model (see `runLadder`) on a transient failure.
 * Returns the same AiCompletionResult shape used by the legacy client.
 */
export async function kaleGenerateText(
  systemPrompt: string,
  userPrompt: string,
  opts?: { maxTokens?: number }
): Promise<AiCompletionResult> {
  const maxTokens = opts?.maxTokens ?? getMaxTokens();
  const apiKey = getApiKey();

  if (!apiKey) {
    throw new Error(`No API key found. Set ANTHROPIC_API_KEY. Model: ${getClaudeModelId()}`);
  }

  return runLadder('blocking', (target, timeoutMs) =>
    callGenerateText(target, systemPrompt, userPrompt, maxTokens, timeoutMs)
  );
}

async function callGenerateText(
  target: KaleTarget,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
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
        system: systemPrompt,
        messages: [
          { role: 'user', content: userPrompt },
        ],
        maxOutputTokens: maxTokens,
        maxRetries: 0,
        abortSignal: abort.signal,
        ...getCallSettings(target.modelId),
      });
    } catch (err) {
      if (abort.signal.aborted) throw new KaleDeadlineError(target.modelId, timeoutMs);
      throw err;
    }

    assertUsableFinish(target, result.finishReason, result.providerMetadata, maxTokens);

    if (!result.text) {
      // Log the response shape (counts only) so an empty answer can be diagnosed. The model's
      // thinking is never used as the answer.
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
 * Stream-based completion using the configured Claude model.
 * Calls `onChunk` for each content delta (for heartbeat emission).
 * Uses the same fallback ladder as `kaleGenerateText`; there is no blocking replay of a failed
 * stream.
 */
export async function kaleStreamText(
  systemPrompt: string,
  userPrompt: string,
  onChunk?: () => void,
  opts?: { maxTokens?: number }
): Promise<AiCompletionResult> {
  const maxTokens = opts?.maxTokens ?? getMaxTokens();

  return runLadder('streaming', (target, timeoutMs) =>
    callStreamText(target, systemPrompt, userPrompt, maxTokens, timeoutMs, onChunk)
  );
}

async function callStreamText(
  target: KaleTarget,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
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
      maxRetries: 0,
      abortSignal: abort.signal,
      onChunk: () => { onChunk?.(); },
      onError: ({ error }) => { streamError = error; },
      ...getCallSettings(target.modelId),
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
