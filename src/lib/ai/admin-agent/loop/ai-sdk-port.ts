/**
 * The default model port: the AI SDK's `streamText` for exactly one model step (plan 3.4).
 *
 * Request shape, all of it decided here and nowhere else:
 *  - tools are declared WITHOUT `execute` (the SDK can never run one) and `stopWhen` is one step; `tool_choice` is never
 *    set and thinking is never disabled, because the 5.5 models answer 400 to a forced tool choice or disabled thinking;
 *  - `thinking: {type: 'adaptive'}` and the conversation's `effort` (the ceiling is `high`);
 *  - `sendReasoning` and `allowSystemInMessages` are set explicitly, not left to the provider default or a console warning;
 *  - `toolStreaming: false`: no tool carries `eager_input_streaming`, so a staging or draft-write call is buffered and
 *    validated by the API before the harness reads it;
 *  - two prompt-cache breakpoints with the configured TTL (1 h): the last system block (the frozen prefix; tools sort
 *    before it) and the last persisted message (the tail). Harness events, including the state refresh, are persisted
 *    messages, so nothing volatile sits after the tail breakpoint and every request replays exactly what the model saw;
 *  - no sampling parameters, no top-level automatic `cacheControl` (it would land on whatever comes last).
 * The open provider questions (system role mid-conversation, thinking-block replay, strict-tool limits, the TTL) are the
 * switches of `ProviderAdapterConfig`; spikes S2 to S5 and S8 settle them.
 */
import { createAnthropic, type AnthropicLanguageModelOptions } from '@ai-sdk/anthropic';
import { APICallError, generateText, jsonSchema, stepCountIs, streamText, tool, type LanguageModel, type ModelMessage, type SystemModelMessage } from 'ai';
import { anthropicApiKey } from '@/lib/ai/api-key';
import type { UsageMeters } from '../store/types';
import { blocksOfContent, DEFAULT_ADAPTER, renderTranscript, type SdkContentPart } from './ai-sdk-messages';
import {
  ModelPortError,
  type AdminModelPort,
  type ModelCompleteInput,
  type ModelCompleteResult,
  type ModelStepInput,
  type ModelStepResult,
  type ProviderAdapterConfig,
  type StopReason,
} from './types';

/** The SDK's own types, derived from the two entry points rather than imported from a package that is only transitive. */
type FetchFunction = NonNullable<NonNullable<Parameters<typeof createAnthropic>[0]>['fetch']>;
type ProviderOptions = NonNullable<Parameters<typeof streamText>[0]['providerOptions']>;

export interface AiSdkPortOptions {
  /** Defaults to `anthropicApiKey()`, the single reader of the key (`ANTHROPIC_API_KEY`, or the deprecated `CLAUDE_API_KEY`). */
  apiKey?: string;
  baseURL?: string;
  /** A fetch to intercept the provider's requests (the contract test records them; nothing else needs it). */
  fetch?: FetchFunction;
  adapter?: Partial<ProviderAdapterConfig>;
  /** Replaces the provider entirely (tests that never reach the request layer). */
  languageModel?: (modelId: string) => LanguageModel;
}

function cacheControl(adapter: ProviderAdapterConfig) {
  return adapter.cacheTtl === '1h' ? ({ type: 'ephemeral', ttl: '1h' } as const) : ({ type: 'ephemeral' } as const);
}

/** The provider options of every request of a conversation. Exported so the contract test and the docs read one source. */
export function providerOptionsFor(effort: ModelStepInput['effort'], adapter: ProviderAdapterConfig): ProviderOptions {
  const anthropic = {
    thinking:
      adapter.thinkingBlockBinding === 'error'
        ? { type: 'adaptive', blockBinding: { prefixMismatchBehavior: 'error' } }
        : { type: 'adaptive' },
    effort,
    sendReasoning: adapter.sendReasoning,
    toolStreaming: false,
  } satisfies AnthropicLanguageModelOptions;
  return { anthropic };
}

function withTailBreakpoint(messages: ModelMessage[], adapter: ProviderAdapterConfig): ModelMessage[] {
  if (messages.length === 0) return messages;
  const last = messages[messages.length - 1];
  const marked = { ...last, providerOptions: { ...last.providerOptions, anthropic: { ...last.providerOptions?.anthropic, cacheControl: cacheControl(adapter) } } } as ModelMessage;
  return [...messages.slice(0, -1), marked];
}

function buildTools(input: ModelStepInput, adapter: ProviderAdapterConfig) {
  const tools: Record<string, ReturnType<typeof tool>> = {};
  input.tools.forEach((wire, index) => {
    const isLast = index === input.tools.length - 1;
    tools[wire.name] = tool({
      description: wire.description,
      inputSchema: jsonSchema(wire.input_schema as unknown as Parameters<typeof jsonSchema>[0]),
      ...(adapter.strictTools && wire.strict ? { strict: true } : {}),
      ...(isLast && adapter.cacheToolsBreakpoint ? { providerOptions: { anthropic: { cacheControl: cacheControl(adapter) } } } : {}),
    });
  });
  return tools;
}

const STOP_BY_RAW: Record<string, StopReason> = {
  end_turn: 'end_turn',
  stop_sequence: 'end_turn',
  pause_turn: 'end_turn',
  tool_use: 'tool_use',
  max_tokens: 'max_tokens',
  refusal: 'refusal',
  model_context_window_exceeded: 'context_exceeded',
};

const STOP_BY_FINISH: Record<string, StopReason> = {
  stop: 'end_turn',
  'tool-calls': 'tool_use',
  length: 'max_tokens',
  'content-filter': 'refusal',
};

/** The provider's stop reason (raw first, the SDK's normalised one as a fallback) as the loop's. */
export function normalizeStopReason(raw: string | undefined, finish: string | undefined): StopReason {
  if (raw !== undefined && raw in STOP_BY_RAW) return STOP_BY_RAW[raw];
  if (raw === undefined && finish !== undefined && finish in STOP_BY_FINISH) return STOP_BY_FINISH[finish];
  return 'other';
}

interface SdkUsage {
  inputTokens: number | undefined;
  inputTokenDetails?: { noCacheTokens: number | undefined; cacheReadTokens: number | undefined; cacheWriteTokens: number | undefined };
  outputTokens: number | undefined;
  raw?: unknown;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * The SDK's usage as the ledger's meters. The SDK reports `inputTokens` as the total (fresh, written and read); the cache
 * writes are split by TTL from the raw `cache_creation` object when the API sent it, else all counted at the configured TTL.
 */
export function usageMeters(usage: SdkUsage, adapter: ProviderAdapterConfig): UsageMeters {
  const read = num(usage.inputTokenDetails?.cacheReadTokens);
  const written = num(usage.inputTokenDetails?.cacheWriteTokens);
  const fresh = usage.inputTokenDetails?.noCacheTokens !== undefined ? num(usage.inputTokenDetails.noCacheTokens) : Math.max(0, num(usage.inputTokens) - read - written);
  let write5m = adapter.cacheTtl === '5m' ? written : 0;
  let write1h = adapter.cacheTtl === '1h' ? written : 0;
  const creation = typeof usage.raw === 'object' && usage.raw !== null ? (usage.raw as { cache_creation?: unknown }).cache_creation : undefined;
  if (typeof creation === 'object' && creation !== null) {
    const split = creation as { ephemeral_5m_input_tokens?: unknown; ephemeral_1h_input_tokens?: unknown };
    const a = num(split.ephemeral_5m_input_tokens);
    const b = num(split.ephemeral_1h_input_tokens);
    if (a + b > 0) {
      write5m = a;
      write1h = b;
    }
  }
  return { inputTokens: fresh, cacheWrite5mTokens: write5m, cacheWrite1hTokens: write1h, cacheReadTokens: read, outputTokens: num(usage.outputTokens) };
}

/** Classifies whatever the SDK or the network threw. The cause stays on the error for the server log. */
export function classifyPortError(error: unknown): ModelPortError {
  if (error instanceof ModelPortError) return error;
  const name = (error as { name?: unknown } | null)?.name;
  if (name === 'TimeoutError' || name === 'AbortError') return new ModelPortError('timeout', { cause: error });
  if (APICallError.isInstance(error)) {
    const status = error.statusCode;
    const text = `${error.message} ${typeof error.responseBody === 'string' ? error.responseBody : ''}`;
    if (status === 400 && /prompt is too long|context (window|length)|too many tokens/i.test(text)) return new ModelPortError('context_exceeded', { cause: error });
    if (status === 401 || status === 403) return new ModelPortError('auth', { cause: error });
    if (status === 408 || status === 409 || status === 429 || (status !== undefined && status >= 500)) return new ModelPortError('unavailable', { cause: error });
    if (status !== undefined && status >= 400) return new ModelPortError('invalid_request', { cause: error });
    return new ModelPortError('unavailable', { cause: error });
  }
  // A dropped connection and similar transport errors carry no status.
  if (error instanceof TypeError) return new ModelPortError('unavailable', { cause: error });
  return new ModelPortError('unknown', { cause: error });
}

export function createAiSdkModelPort(options: AiSdkPortOptions = {}): AdminModelPort {
  const adapter: ProviderAdapterConfig = { ...DEFAULT_ADAPTER, ...options.adapter };
  let provider: ReturnType<typeof createAnthropic> | null = null;
  const modelFor = (modelId: string): LanguageModel => {
    if (options.languageModel) return options.languageModel(modelId);
    provider ??= createAnthropic({
      apiKey: options.apiKey ?? (anthropicApiKey() || undefined),
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
    return provider(modelId);
  };

  return {
    async step(input: ModelStepInput): Promise<ModelStepResult> {
      const system: SystemModelMessage[] = [{ role: 'system', content: input.system, providerOptions: { anthropic: { cacheControl: cacheControl(adapter) } } }];
      const messages = withTailBreakpoint(renderTranscript(input.transcript, { adapter, sentinel: input.sentinel }), adapter);

      const result = streamText({
        model: modelFor(input.model),
        system,
        messages,
        allowSystemInMessages: true,
        tools: buildTools(input, adapter),
        stopWhen: stepCountIs(1),
        maxOutputTokens: input.maxOutputTokens,
        maxRetries: 1,
        // The call's own deadline. This is not the request's signal: the loop never observes the client (spike S7).
        abortSignal: AbortSignal.timeout(input.timeoutMs),
        providerOptions: providerOptionsFor(input.effort, adapter),
        // Failures are read from the stream below; the SDK's default would log the whole error object, request body included.
        onError: () => undefined,
      });

      let streamError: unknown;
      let aborted = false;
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          try {
            input.onTextDelta?.(part.text);
          } catch {
            // A broken sink never stops the step.
          }
        } else if (part.type === 'error') {
          streamError ??= part.error;
        } else if (part.type === 'abort') {
          aborted = true;
        }
      }
      if (streamError !== undefined) throw classifyPortError(streamError);
      if (aborted) throw new ModelPortError('timeout');

      let content: readonly SdkContentPart[];
      let finish: string | undefined;
      let raw: string | undefined;
      let usage: SdkUsage;
      let modelId: string;
      try {
        [content, finish, raw, usage, modelId] = await Promise.all([
          result.content as PromiseLike<readonly SdkContentPart[]>,
          result.finishReason,
          result.rawFinishReason,
          result.usage as PromiseLike<SdkUsage>,
          Promise.resolve(result.response).then((response) => response.modelId),
        ]);
      } catch (error) {
        throw classifyPortError(error);
      }

      const converted = blocksOfContent(content);
      if (converted.droppedThinking > 0) console.warn(`[admin-agent] ${converted.droppedThinking} thinking part(s) without a signature were not kept`);
      const toolCalls = converted.blocks.flatMap((block) =>
        block.type === 'tool_use'
          ? [{ id: block.id, name: block.name, input: block.input, ...(converted.invalidToolCallIds.includes(block.id) ? { invalid: true } : {}) }]
          : [],
      );
      return {
        blocks: converted.blocks,
        toolCalls,
        stopReason: normalizeStopReason(raw, finish),
        rawStopReason: raw ?? finish ?? null,
        usage: usageMeters(usage, adapter),
        model: modelId || input.model,
      };
    },

    async complete(input: ModelCompleteInput): Promise<ModelCompleteResult> {
      try {
        const result = await generateText({
          model: modelFor(input.model),
          system: input.system,
          prompt: input.prompt,
          maxOutputTokens: input.maxOutputTokens,
          maxRetries: 1,
          abortSignal: AbortSignal.timeout(input.timeoutMs),
          providerOptions: providerOptionsFor(input.effort, adapter),
        });
        return { text: result.text, usage: usageMeters(result.usage as SdkUsage, adapter), model: result.response.modelId || input.model };
      } catch (error) {
        throw classifyPortError(error);
      }
    },
  };
}
