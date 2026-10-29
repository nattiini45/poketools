import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { ProviderOptions } from '@ai-sdk/provider-utils';
import type { LanguageModel } from 'ai';
import { anthropicApiKey } from '../api-key';

/**
 * AI Agent provider helper (PRD §2 — Model Tiering).
 *
 * The agent reaches T0/T0-V models through **direct OpenAI-compatible API
 * endpoints** (DeepSeek, Xiaomi, MiniMax) and the paid T2 fallback through
 * Anthropic via `@ai-sdk/anthropic`. This mirrors the provider quirks already
 * handled in `src/lib/ai/kale/provider.ts` (system-message mode, reasoning
 * detection) but is a standalone helper — kale/provider.ts is left untouched.
 */

// ─── Types ──────────────────────────────────────────────────────────

export type AgentProvider = 'deepseek' | 'xiaomi' | 'minimax' | 'anthropic';

export interface AgentModelConfig {
  /** Stable identifier used in the registry, telemetry, and the smoke report. */
  id: string;
  /** Which direct-API provider serves this model. */
  provider: AgentProvider;
  /** The provider-side model name passed to the SDK. */
  modelName: string;
}

/** Tiers from PRD §2. T1 escalation reuses the *other* T0 entry, so no T1 row. */
export type AgentModelTier = 'T0' | 'T0-V' | 'T2';

export interface AgentModelEntry extends AgentModelConfig {
  tier: AgentModelTier;
}

// ─── Env mapping ────────────────────────────────────────────────────

interface CompatEnv {
  apiKeyVar: string;
  baseUrlVar: string;
}

/** OpenAI-compatible providers read an API key + base URL pair. */
const COMPAT_ENV: Record<Exclude<AgentProvider, 'anthropic'>, CompatEnv> = {
  deepseek: { apiKeyVar: 'DEEPSEEK_API_KEY', baseUrlVar: 'DEEPSEEK_BASE_URL' },
  xiaomi: { apiKeyVar: 'XIAOMI_API_KEY', baseUrlVar: 'XIAOMI_BASE_URL' },
  minimax: { apiKeyVar: 'MINIMAX_API_KEY', baseUrlVar: 'MINIMAX_BASE_URL' },
};

function envValue(name: string): string {
  return (process.env[name] ?? '').trim();
}

// ─── Model registry (PRD §2) ────────────────────────────────────────

/**
 * Model name strings for the exotic providers come from env overrides with
 * sensible literal defaults, so the deployed model can be retuned without a
 * code change. Anthropic tier names are pinned literals.
 */
function deepseekModelName(): string {
  return envValue('AGENT_DEEPSEEK_MODEL') || 'deepseek-v4-pro';
}

/**
 * Retired model ids still found in stored `model_priority` arrays, mapped to the
 * registry id that replaced them. Xiaomi invalidated `mimo-v2.5-pro` on
 * 2026-10-21 10:00 (UTC+8) and named `mimo-v2.6-pro` as its replacement.
 */
export const LEGACY_MODEL_IDS: Readonly<Record<string, string>> = {
  'mimo-v2.5-pro': 'mimo-v2.6-pro',
};

function xiaomiModelName(): string {
  return envValue('AGENT_XIAOMI_MODEL') || 'mimo-v2.6-pro';
}

function minimaxModelName(): string {
  return envValue('AGENT_MINIMAX_MODEL') || 'minimax-m3';
}

/**
 * Built-in tier registry in escalation order (PRD §2): the T0 text candidates
 * first (Xiaomi `mimo-v2.6-pro` is the eval-gated default T0, DeepSeek the T1
 * escalation — both tier `T0`, the order is the escalation order), the T0-V
 * vision model, then the paid Anthropic T2 fallbacks (Haiku before Sonnet).
 */
const BUILTIN_MODELS: readonly AgentModelEntry[] = [
  { id: 'mimo-v2.6-pro', provider: 'xiaomi', modelName: xiaomiModelName(), tier: 'T0' },
  { id: 'deepseek-v4-pro', provider: 'deepseek', modelName: deepseekModelName(), tier: 'T0' },
  { id: 'minimax-m3', provider: 'minimax', modelName: minimaxModelName(), tier: 'T0-V' },
  { id: 'claude-haiku-4-5', provider: 'anthropic', modelName: 'claude-haiku-4-5', tier: 'T2' },
  { id: 'claude-sonnet-4-6', provider: 'anthropic', modelName: 'claude-sonnet-4-6', tier: 'T2' },
];

/**
 * `AGENT_DEFAULT_MODEL` selects which *registered model id* leads the registry
 * (the default T0). The named id floats to the front; the rest keep their
 * built-in escalation order. An unknown id warns and falls back to the built-in
 * order — it does NOT change any provider-side model name (use
 * `AGENT_DEEPSEEK_MODEL` / `AGENT_XIAOMI_MODEL` / `AGENT_MINIMAX_MODEL` for that).
 */
function orderByDefault(builtin: readonly AgentModelEntry[]): AgentModelEntry[] {
  const rawDefault = envValue('AGENT_DEFAULT_MODEL');
  const defaultId = LEGACY_MODEL_IDS[rawDefault] ?? rawDefault;
  if (!defaultId) return [...builtin];
  const target = builtin.find((m) => m.id === defaultId);
  if (!target) {
    console.warn(
      `AGENT_DEFAULT_MODEL="${defaultId}" is not a known agent model id; using built-in tier order. ` +
        `Known ids: ${builtin.map((m) => m.id).join(', ')}`,
    );
    return [...builtin];
  }
  return [target, ...builtin.filter((m) => m.id !== defaultId)];
}

/** Ordered tier registry (escalation order), with the `AGENT_DEFAULT_MODEL` override applied. */
export const AGENT_MODELS: readonly AgentModelEntry[] = orderByDefault(BUILTIN_MODELS);

// ─── Configuration check ────────────────────────────────────────────

/**
 * True when the env vars this model needs are all non-empty. OpenAI-compatible
 * providers require both an API key and a base URL; Anthropic requires only
 * `ANTHROPIC_API_KEY` (or the deprecated `CLAUDE_API_KEY`).
 */
export function isModelConfigured(config: AgentModelConfig): boolean {
  if (config.provider === 'anthropic') {
    return anthropicApiKey().length > 0;
  }
  const { apiKeyVar, baseUrlVar } = COMPAT_ENV[config.provider];
  return envValue(apiKeyVar).length > 0 && envValue(baseUrlVar).length > 0;
}

// ─── Model factory ──────────────────────────────────────────────────

/**
 * Build a Vercel AI SDK `LanguageModel` for the given agent model config.
 * Throws if the required env vars are missing — call {@link isModelConfigured}
 * first if you want to skip unconfigured models gracefully.
 */
export function createCompatibleModel(config: AgentModelConfig): LanguageModel {
  if (config.provider === 'anthropic') {
    const apiKey = anthropicApiKey();
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is required for the Anthropic agent tier');
    }
    return createAnthropic({ apiKey })(config.modelName);
  }

  const { apiKeyVar, baseUrlVar } = COMPAT_ENV[config.provider];
  const apiKey = envValue(apiKeyVar);
  const baseURL = envValue(baseUrlVar);
  if (!apiKey || !baseURL) {
    throw new Error(`${apiKeyVar} and ${baseUrlVar} are required for the "${config.provider}" agent provider`);
  }

  // Use `.chat()` to force the Chat Completions API (/chat/completions). The
  // default provider(modelName) call uses the Responses API (/responses), which
  // most OpenAI-compatible providers reject or mishandle. See kale/provider.ts.
  return createOpenAI({ apiKey, baseURL, name: `agent-${config.provider}` }).chat(config.modelName);
}

/**
 * Provider options for `generateText` / `streamText` calls against an
 * OpenAI-compatible agent model. Returns `undefined` for Anthropic (the SDK
 * handles its native shape). Pins `systemMessageMode: 'system'` and disables
 * reasoning-model auto-detection so these providers don't get their request
 * rewritten (system→developer, max_tokens→max_completion_tokens, temperature
 * stripped). Mirrors `getProviderOptions()` in kale/provider.ts.
 */
export function getAgentProviderOptions(config: AgentModelConfig): ProviderOptions | undefined {
  if (config.provider === 'anthropic') return undefined;
  const reasoningEffort = (envValue('AGENT_REASONING_EFFORT') || 'none') as 'none' | 'low' | 'medium' | 'high';
  return {
    [`agent-${config.provider}`]: {
      systemMessageMode: 'system' as const,
      forceReasoning: false,
      reasoningEffort,
    },
  };
}
