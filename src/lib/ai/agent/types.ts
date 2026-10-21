/**
 * Transport-agnostic agent types (PRD §10).
 *
 * These types are the contract between any transport (the Next.js route
 * handlers, a future Discord bot, a CLI) and the pure `runAgent()` core. NO
 * Next.js / HTTP / React types may be imported here — keeping the core
 * transport-agnostic is a hard PRD requirement (§1 Principle 4).
 */
import type { AgentModelTier } from './provider';
import type { Locale } from '@/i18n/config';

// ─── Personas (PRD §4) ───────────────────────────────────────────────

/** The three v1 personas. `kale` is wired but stubbed until Stage 5 (PRD §4). */
export type AgentPersona = 'kale' | 'linden_match_prep' | 'linden_teambuilding';

// ─── Messages ────────────────────────────────────────────────────────

export type AgentMessageRole = 'system' | 'user' | 'assistant';

/**
 * A single conversation message. Mirrors the `agent_conversations.messages`
 * JSONB shape (PRD §6) — `tool_calls` / `tool_results` are optional so a plain
 * text turn stays compact.
 */
export interface AgentMessage {
  role: AgentMessageRole;
  content: string;
  tool_calls?: AgentToolCall[];
  tool_results?: AgentToolResult[];
}

export interface AgentToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface AgentToolResult {
  call_id: string;
  name: string;
  output: unknown;
}

// ─── Request context (PRD §7 chat body `context`) ────────────────────

export interface AgentContext {
  upcoming_match_id?: string;
  format?: string;
  team_id?: string;
  /** Up to two locked core Pokémon the user wants the team built around. */
  core_pokemon?: string[];
  /**
   * Active league ruleset id (e.g. the tournament/match-prep ruleset). When
   * present the orchestrator loads it (via `resolveEffectiveRuleset`) and the
   * player's assigned core, so the assistant builds within the league's bans,
   * clauses, type-quotas and core constraints — not just the base format.
   * Distinct from {@link core_pokemon} (user "build-around" species).
   */
  ruleset_id?: string;
}

// ─── Request / Response ──────────────────────────────────────────────

export interface AgentRequest {
  /** Identity flows from here, never from a cookie inside a tool (PRD §5). */
  userId: string;
  persona: AgentPersona;
  messages: AgentMessage[];
  context?: AgentContext;
  /**
   * Existing conversation to append this turn to (PRD §6 / §7 chat body
   * `conversation_id`). When absent, `runAgent()` opens a fresh conversation.
   */
  conversationId?: string;
  /**
   * Language the answer is written in (i18n-core §6.4): the league's content
   * language for stored analyses, the viewer's UI language for live chat.
   * When absent the system prompt carries no language line. Ignored for the
   * `kale` persona, which stays English.
   */
  outputLocale?: Locale;
}

/**
 * One escalation hop in the model-router fallback chain (PRD §2). Logged to
 * telemetry and surfaced in the response metadata.
 */
export interface EscalationLog {
  from: string;
  to: string;
  reason: EscalationReason;
}

/**
 * Escalation triggers. The first four are the PRD §2 triggers; `provider-auth`
 * and `provider-error` cover provider-side failures a same-model retry cannot
 * fix (a dead/forbidden key, or a non-retryable API call error such as an
 * invalid model / invalid_request_error) — escalating keeps the agent alive on
 * the remaining tiers.
 */
export type EscalationReason =
  | 'rate_limit'
  | 'tool_schema'
  | 'empty_truncated'
  | 'timeout'
  | 'provider-auth'
  | 'provider-error';

/**
 * Response metadata (PRD §13.1 / §9 telemetry): which model finally answered,
 * its tier, the escalation chain it took to get there, and the tool-call count.
 */
export interface AgentResponseMetadata {
  /** Final model id that produced the answer. */
  model: string;
  tier: AgentModelTier;
  /** Escalation hops taken (empty when the first model succeeded). */
  escalations: EscalationLog[];
  /** Number of tool invocations across the run. */
  tool_calls: number;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  /** Persisted conversation row this turn was appended to, when applicable. */
  conversation_id?: string;
  persona: AgentPersona;
}

export interface AgentResponse {
  message: AgentMessage;
  metadata: AgentResponseMetadata;
}
