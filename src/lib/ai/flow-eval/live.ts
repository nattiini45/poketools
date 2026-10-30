/**
 * The live model caller of the AI flow eval: it goes through the app's own call paths, so the
 * eval measures what production sends.
 *
 * - Kale tasks: `kaleGenerateText` (AI SDK, primary model then fallback ladder), as the pipeline calls it.
 * - Everything else: `completeStreaming` (analysis, scouting; they stream in production) or
 *   `complete` (coaches, recap) of `client.ts`.
 *
 * Both modules read the API key (`anthropicApiKey()`: `ANTHROPIC_API_KEY`, then the deprecated `CLAUDE_API_KEY`), and Kale reads the model
 * and effort from `CLAUDE_MODEL` / `CLAUDE_API_EFFORT` on every call, so the entry script sets the
 * environment first and this module imports them lazily.
 */

import type { CallRequest, CallSettings, ModelCaller, ModelResponse } from './types';
import type { AiCompletionResult } from '../client';

function toResponse(result: AiCompletionResult): ModelResponse {
  return {
    content: result.content,
    model: result.model,
    promptTokens: result.prompt_tokens,
    completionTokens: result.completion_tokens,
    cacheReadTokens: result.cache_read_input_tokens ?? 0,
    cacheWriteTokens: result.cache_creation_input_tokens ?? 0,
    stopReason: result.stop_reason ?? null,
    stopCategory: result.stop_category ?? null,
    fallbackUsed: result.fallback_used ?? false,
  };
}

const STREAMED_SURFACES = new Set(['match-analysis', 'match-prep-analysis']);

export async function createLiveCaller(): Promise<ModelCaller> {
  const [client, provider] = await Promise.all([import('../client'), import('../kale/provider')]);
  return async (request: CallRequest, settings: CallSettings): Promise<ModelResponse> => {
    const options = { model: settings.model, effort: settings.effort, maxTokens: request.maxTokens, jsonOutput: request.jsonOutput, surface: request.surface };
    if (request.surface === 'kale') {
      return toResponse(await provider.kaleGenerateText(request.system, request.user, { maxTokens: request.maxTokens }));
    }
    if (STREAMED_SURFACES.has(request.surface)) {
      return toResponse(await client.completeStreaming(request.system, request.user, undefined, undefined, options));
    }
    return toResponse(await client.complete(request.system, request.user, options));
  };
}
