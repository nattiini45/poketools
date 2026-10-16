import { generateText, streamText, type LanguageModel } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { ProviderOptions } from '@ai-sdk/provider-utils';
import type { AiCompletionResult } from '../client';
import { logger } from '@/lib/logger';

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
  return process.env.KALE_MODEL || process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
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

function getPrimaryModel(): LanguageModel {
  return buildModel(getModelId());
}

function getFallbackModel(): LanguageModel | null {
  const id = getFallbackModelId();
  return id ? buildModel(id) : null;
}

// ─── Blocking Completion ────────────────────────────────────────────

/**
 * Generate text with the configured Kale model.
 * Tries primary model first, falls back to fallback model on failure.
 * Returns the same AiCompletionResult shape used by the legacy client.
 */
export async function kaleGenerateText(
  systemPrompt: string,
  userPrompt: string,
  opts?: { maxTokens?: number; temperature?: number }
): Promise<AiCompletionResult> {
  const maxTokens = opts?.maxTokens ?? getMaxTokens();
  const temperature = opts?.temperature ?? getTemperature();
  const timeoutMs = getTimeoutMs();
  const apiKey = getApiKey();

  if (!apiKey) {
    throw new Error(`No API key found. Set KALE_API_KEY or CLAUDE_API_KEY. Provider: ${getProvider()}, Model: ${getModelId()}`);
  }

  // Try primary model
  let lastError: string = 'unknown';
  try {
    return await callGenerateText(getPrimaryModel(), systemPrompt, userPrompt, maxTokens, temperature, timeoutMs);
  } catch (primaryError) {
    lastError = primaryError instanceof Error ? primaryError.message : String(primaryError);
    // Log full error details for debugging provider compatibility
    const errObj = primaryError as Record<string, unknown>;
    const statusCode = errObj?.statusCode ?? errObj?.status ?? '';
    console.error(`[kale/provider] Primary model (${getProvider()}/${getModelId()}) failed: ${lastError}${statusCode ? ` [${statusCode}]` : ''}`);
  }

  // Try explicit fallback model (same provider)
  const fallback = getFallbackModel();
  if (fallback) {
    try {
      logger.warn('kale/provider', `Trying fallback model: ${getFallbackModelId()}`);
      return await callGenerateText(fallback, systemPrompt, userPrompt, maxTokens, temperature, getFallbackTimeoutMs());
    } catch (fallbackError) {
      lastError = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      console.error(`[kale/provider] Fallback model failed:`, lastError);
    }
  }

  // Last resort: if primary provider wasn't Anthropic and CLAUDE_API_KEY exists, try Anthropic
  // Set KALE_DISABLE_FALLBACK=true to skip this (useful during testing to avoid Anthropic costs)
  const claudeKey = process.env.CLAUDE_API_KEY;
  const fallbackDisabled = process.env.KALE_DISABLE_FALLBACK === 'true';
  if (!fallbackDisabled && getProvider() !== 'anthropic' && claudeKey) {
    try {
      const claudeModel = process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6';
      logger.warn('kale/provider', `Primary provider failed, falling back to Anthropic (${claudeModel})`);
      const anthropicModel = createAnthropic({ apiKey: claudeKey })(claudeModel);
      return await callGenerateText(anthropicModel, systemPrompt, userPrompt, maxTokens, temperature, getFallbackTimeoutMs());
    } catch (claudeError) {
      lastError = claudeError instanceof Error ? claudeError.message : String(claudeError);
      console.error(`[kale/provider] Anthropic fallback also failed:`, lastError);
    }
  }

  throw new Error(`All Kale model attempts failed (${getProvider()}/${getModelId()}): ${lastError}`);
}

async function callGenerateText(
  model: LanguageModel,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  temperature: number,
  timeoutMs: number
): Promise<AiCompletionResult> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);

  try {
    const result = await generateText({
      model,
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
        return {
          content: reasoningText,
          model: resp?.modelId ?? 'unknown',
          prompt_tokens: result.usage?.inputTokens ?? 0,
          completion_tokens: result.usage?.outputTokens ?? 0,
        };
      }

      throw new Error(
        `Empty response from model (finishReason=${finishReason}, outputTokens=${result.usage?.outputTokens ?? 0})`
      );
    }

    return {
      content: result.text,
      model: result.response?.modelId ?? 'unknown',
      prompt_tokens: result.usage?.inputTokens ?? 0,
      completion_tokens: result.usage?.outputTokens ?? 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Streaming Completion ───────────────────────────────────────────

/**
 * Stream-based completion using the configured Kale model.
 * Calls `onChunk` for each content delta (for heartbeat emission).
 * Falls back to blocking `kaleGenerateText()` as last resort.
 */
export async function kaleStreamText(
  systemPrompt: string,
  userPrompt: string,
  onChunk?: () => void,
  opts?: { maxTokens?: number; temperature?: number }
): Promise<AiCompletionResult> {
  const maxTokens = opts?.maxTokens ?? getMaxTokens();
  const temperature = opts?.temperature ?? getTemperature();
  const timeoutMs = getTimeoutMs();

  // Try primary model streaming
  try {
    return await callStreamText(getPrimaryModel(), systemPrompt, userPrompt, maxTokens, temperature, timeoutMs, onChunk);
  } catch (primaryError) {
    console.error(
      `[kale/provider] Primary streaming failed:`,
      primaryError instanceof Error ? primaryError.message : primaryError
    );
  }

  // Try fallback model streaming
  const fallback = getFallbackModel();
  if (fallback) {
    try {
      logger.warn('kale/provider', `Falling back to ${getFallbackModelId()} (streaming)`);
      return await callStreamText(fallback, systemPrompt, userPrompt, maxTokens, temperature, getFallbackTimeoutMs(), onChunk);
    } catch (fallbackError) {
      console.error(
        `[kale/provider] Fallback streaming failed:`,
        fallbackError instanceof Error ? fallbackError.message : fallbackError
      );
    }
  }

  // Last resort: blocking mode
  logger.warn('kale/provider', 'All streaming attempts failed, trying blocking mode');
  return await kaleGenerateText(systemPrompt, userPrompt, { maxTokens, temperature });
}

async function callStreamText(
  model: LanguageModel,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  temperature: number,
  timeoutMs: number,
  onChunk?: () => void
): Promise<AiCompletionResult> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);

  try {
    const result = streamText({
      model,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userPrompt },
      ],
      maxOutputTokens: maxTokens,
      temperature,
      maxRetries: 0,
      abortSignal: abort.signal,
      onChunk: () => { onChunk?.(); },
      providerOptions: getProviderOptions(),
    });

    // Consume the stream to get the full text
    const text = await result.text;

    if (!text) {
      throw new Error('Empty streaming response from model');
    }

    const usage = await result.usage;
    const response = await result.response;

    return {
      content: text,
      model: response?.modelId ?? 'unknown',
      prompt_tokens: usage?.inputTokens ?? 0,
      completion_tokens: usage?.outputTokens ?? 0,
    };
  } finally {
    clearTimeout(timer);
  }
}
