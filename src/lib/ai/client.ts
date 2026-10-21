import Anthropic from '@anthropic-ai/sdk';
import { initLogger, wrapAnthropic } from 'braintrust';
import { logger } from '@/lib/logger';

// ─── Configuration ──────────────────────────────────────────────────

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY ?? '';
const DEFAULT_MODEL = process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6';
const FALLBACK_MODEL = process.env.CLAUDE_FALLBACK_MODEL ?? 'claude-haiku-4-5-20251001';
const BRAINTRUST_API_KEY = process.env.BRAINTRUST_API_KEY ?? '';

// ─── Braintrust Observability ───────────────────────────────────────

if (BRAINTRUST_API_KEY) {
  initLogger({ projectName: 'poketools', apiKey: BRAINTRUST_API_KEY });
}

/** Max wall time for the primary model attempt */
const PRIMARY_TIMEOUT_MS = 200_000;

/** Max wall time for the fallback model attempt */
const FALLBACK_TIMEOUT_MS = 100_000;

/** Default max tokens for Claude API (required parameter) */
const DEFAULT_MAX_TOKENS = 4096;

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
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
}

// ─── Completion ─────────────────────────────────────────────────────

/**
 * Call the LLM with a system prompt and user prompt.
 * Tries the default model first; on failure retries once with the fallback model.
 */
export async function complete(
  systemPrompt: string,
  userPrompt: string
): Promise<AiCompletionResult> {
  const client = getClient();

  // Try primary model
  try {
    return await callModel(client, DEFAULT_MODEL, systemPrompt, userPrompt, PRIMARY_TIMEOUT_MS);
  } catch (primaryError) {
    console.error(
      `[ai/client] Primary model ${DEFAULT_MODEL} failed:`,
      primaryError instanceof Error ? primaryError.message : primaryError
    );
  }

  // Fallback model (throws on failure — caller handles)
  logger.warn('ai/client', `Falling back to ${FALLBACK_MODEL}`);
  return await callModel(client, FALLBACK_MODEL, systemPrompt, userPrompt, FALLBACK_TIMEOUT_MS);
}

async function callModel(
  client: Anthropic,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  timeoutMs: number
): Promise<AiCompletionResult> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);

  try {
    const response = await client.messages.create({
      model,
      max_tokens: DEFAULT_MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      temperature: 0.2,
    }, { signal: abort.signal });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    if (!text) {
      throw new Error(`Empty response from model ${model}`);
    }

    return {
      content: text,
      model: response.model,
      prompt_tokens: response.usage.input_tokens,
      completion_tokens: response.usage.output_tokens,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Streaming Completion ────────────────────────────────────────────

/**
 * Stream-based completion that calls the LLM with streaming enabled.
 * Each incoming chunk resets internal timeouts, preventing hangs
 * during long thinking phases. Calls `onChunk` for each content delta
 * so the caller can emit heartbeats.
 *
 * Falls back to blocking `complete()` if streaming fails.
 */
export async function completeStreaming(
  systemPrompt: string,
  userPrompt: string,
  onChunk?: () => void,
  maxTokens?: number
): Promise<AiCompletionResult> {
  try {
    return await callModelStreaming(getClient(), DEFAULT_MODEL, systemPrompt, userPrompt, PRIMARY_TIMEOUT_MS, onChunk, maxTokens);
  } catch (primaryError) {
    console.error(
      `[ai/client] Primary streaming model ${DEFAULT_MODEL} failed:`,
      primaryError instanceof Error ? primaryError.message : primaryError
    );
  }

  // Fallback model (throws on failure — caller handles)
  try {
    logger.warn('ai/client', `Falling back to ${FALLBACK_MODEL} (streaming)`);
    return await callModelStreaming(getClient(), FALLBACK_MODEL, systemPrompt, userPrompt, FALLBACK_TIMEOUT_MS, onChunk, maxTokens);
  } catch (fallbackStreamError) {
    console.error(
      `[ai/client] Fallback streaming failed, trying blocking mode:`,
      fallbackStreamError instanceof Error ? fallbackStreamError.message : fallbackStreamError
    );
    // Last resort: blocking mode (original behavior)
    return await complete(systemPrompt, userPrompt);
  }
}

async function callModelStreaming(
  client: Anthropic,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  timeoutMs: number,
  onChunk?: () => void,
  maxTokens?: number
): Promise<AiCompletionResult> {
  const startTime = Date.now();

  try {
    const stream = client.messages.stream({
      model,
      max_tokens: maxTokens ?? DEFAULT_MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      temperature: 0.2,
    });

    let content = '';

    for await (const event of stream) {
      // Hard wall clock check — abort if this model attempt has taken too long
      if (Date.now() - startTime > timeoutMs) {
        logger.warn('ai/client', `Model ${model} exceeded ${timeoutMs / 1000}s wall time — aborting`);
        stream.abort();
        throw new Error(`Model ${model} exceeded wall time limit of ${timeoutMs / 1000}s`);
      }

      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        content += event.delta.text;
      }

      onChunk?.();
    }

    if (!content) {
      throw new Error(`Empty streaming response from model ${model}`);
    }

    const finalMessage = await stream.finalMessage();

    return {
      content,
      model: finalMessage.model,
      prompt_tokens: finalMessage.usage.input_tokens,
      completion_tokens: finalMessage.usage.output_tokens,
    };
  } catch (err) {
    throw err instanceof Error ? err : new Error(`Model ${model} streaming failed`);
  }
}
