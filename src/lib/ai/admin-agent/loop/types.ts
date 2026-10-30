/**
 * Shapes of the loop (plan 3.1, 3.4, 5.7; spec §18.10): the model port, the tool runtime port, the stream events and the
 * dependencies a turn needs. The loop knows no provider and no Next API: everything it touches is injected, so a turn
 * runs under test with a fake port and an in-memory store.
 */
import type { AuditLogEntry } from '@/lib/audit/log';
import type { DispatchContext } from '../dispatch/types';
import type { AdminAgentConfig, AdminAgentEffort, AdminAgentPhase } from '../env';
import type { ToolResult, ToolRole, ToolSet, WireTool } from '../registry';
import type { AdminAgentStore } from '../store/create';
import type { AdminId } from '../store/ids';
import type { Json, NewRef, UsageMeters } from '../store/types';
import type { AssistantBlock } from './blocks';
import type { TranscriptEntry } from './transcript';

export type Locale = 'en' | 'de';

// ─── The model port ──────────────────────────────────────────────────

/** Why a model step ended, normalised from the provider's stop reason. */
export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'context_exceeded' | 'other';

export interface ModelStepInput {
  /** The conversation's pinned model. */
  model: string;
  effort: AdminAgentEffort;
  /** The frozen system prompt. */
  system: string;
  /** The frozen tools, sorted by name. */
  tools: readonly WireTool[];
  /** The persisted transcript, oldest first; the port's adapter renders it for the provider. */
  transcript: readonly TranscriptEntry[];
  /** This conversation's harness sentinel (used only by the `sentinel-user` channel). */
  sentinel: string;
  maxOutputTokens: number;
  /**
   * Called with each text delta as it streams. A throw is swallowed. There is deliberately no abort signal here: the loop
   * never observes the client connection (spike S7); the port enforces its own wall-clock timeout.
   */
  onTextDelta?: (delta: string) => void;
  /** The longest this one call may take, in milliseconds (the port aborts itself after it; it is not the request's signal). */
  timeoutMs: number;
}

/** One entry of the API's per-sampling `usage.iterations` array, narrowed to what a log line needs. */
export interface ModelIteration {
  /** `message`, `compaction`, `advisor_message` or `fallback_message`. Anything but `message` is billed apart from the totals. */
  type: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Why a call ended, as the provider reported it, beyond the normalised `StopReason`. Every field is optional: a port that
 * cannot tell (a fake, a replay) leaves them out.
 */
export interface ModelStopInfo {
  /** The SDK's normalised finish reason (`stop`, `length`, `content-filter`, `tool-calls`, ...). */
  finishReason?: string;
  /** The provider's raw stop reason (`end_turn`, `max_tokens`, `refusal`, ...). */
  rawFinishReason?: string;
  /** Present on a refusal that carried `stop_details`. The category is the classifier's (`cyber`, `bio`, ...), when it named one. */
  stopDetails?: { category?: string };
  /** The API's usage iterations, when it sent them. */
  iterations?: readonly ModelIteration[];
}

export interface ModelStepResult extends ModelStopInfo {
  /** The assistant message exactly as the model produced it, thinking blocks included. Never empty. */
  blocks: AssistantBlock[];
  /** Tool calls in order, parsed from `blocks`; `invalid` when the provider could not parse the input. */
  toolCalls: ModelToolCall[];
  stopReason: StopReason;
  /** The provider's own stop reason string, for logs. */
  rawStopReason: string | null;
  usage: UsageMeters;
  /** The model id that answered. */
  model: string;
}

export interface ModelToolCall {
  id: string;
  name: string;
  input: Json;
  invalid?: boolean;
}

export interface ModelCompleteInput {
  model: string;
  effort: AdminAgentEffort;
  system: string;
  prompt: string;
  maxOutputTokens: number;
  timeoutMs: number;
}

export interface ModelCompleteResult extends ModelStopInfo {
  text: string;
  usage: UsageMeters;
  model: string;
  /** The normalised stop reason, when the port knows it. A call that ended on `max_tokens` or `refusal` has an unreliable `text`. */
  stopReason?: StopReason;
}

export type ModelPortErrorKind = 'unavailable' | 'timeout' | 'invalid_request' | 'auth' | 'context_exceeded' | 'unknown';

/** A provider failure, classified. The loop maps it to a catalogued code; the cause stays in the server log. */
export class ModelPortError extends Error {
  readonly kind: ModelPortErrorKind;
  readonly retryable: boolean;
  constructor(kind: ModelPortErrorKind, options: { cause?: unknown; retryable?: boolean } = {}) {
    super(`admin-agent model port: ${kind}`, { cause: options.cause });
    this.name = 'ModelPortError';
    this.kind = kind;
    this.retryable = options.retryable ?? (kind === 'unavailable' || kind === 'timeout');
  }
}

/**
 * One model step in, one assistant message out. A port makes exactly one provider request per `step` and never runs a
 * tool. `complete` is the small side call (titles) with no tools and no conversation prefix.
 */
export interface AdminModelPort {
  step(input: ModelStepInput): Promise<ModelStepResult>;
  complete(input: ModelCompleteInput): Promise<ModelCompleteResult>;
}

/** How the AI SDK port talks to the provider; the three open questions of the S2/S3/S5 spikes are switches here. */
export interface ProviderAdapterConfig {
  /**
   * How harness events reach the model. `system-message` (default, needs spike S2) sends a `system` role message
   * mid-conversation; `sentinel-user` sends a user message that starts with the per-conversation sentinel tag.
   */
  stateChannel: 'system-message' | 'sentinel-user';
  /**
   * `system-message` only: the API wants a system message to follow a user message, so after an assistant message the
   * port inserts a one-line user anchor (`auto`) or does not (`never`, if S2 shows it is not needed).
   */
  systemAnchor: 'auto' | 'never';
  /** Send `strict: true` on the tools the set's strict budget marks (spike S4: at most 20 strict tools, 24 optional and 16 union parameters per request); false sends none. */
  strictTools: boolean;
  /** Replay thinking blocks (`sendReasoning`). Off only if spike S3 fails and thinking is dropped from history. */
  sendReasoning: boolean;
  /** Prompt-cache lifetime of both breakpoints (spike S5). */
  cacheTtl: '5m' | '1h';
  /** Also put a breakpoint on the last tool, so a prompt-only change keeps the tool cache. */
  cacheToolsBreakpoint: boolean;
  /**
   * Thinking-block binding (spike S8). `default` sends nothing (the API's default accepts an edited prefix); `error`
   * asks the API to refuse a replayed thinking block whose prefix changed, so a history bug fails loudly. The history
   * is append-only either way; eval runs use `error`.
   */
  thinkingBlockBinding: 'default' | 'error';
}

// ─── Stream events (spec §18.5 "Stream events"; plan 5.7) ────────────

export type DoneReason =
  | 'completed'
  | 'deadline'
  | 'step_limit'
  | 'tool_limit'
  | 'refused'
  | 'truncated'
  | 'budget'
  | 'context'
  | 'model_error'
  | 'failed'
  | 'duplicate';

/** Events carry data, never HTML. `error` always carries a catalogued code. */
export type AgentStreamEvent =
  | { type: 'text.delta'; step: number; delta: string }
  | { type: 'tool.start'; id: string; name: string; label_code: string }
  | { type: 'tool.end'; id: string; name: string; ok: boolean; code?: string }
  | { type: 'card'; kind: string; ref: string }
  | { type: 'plan.updated'; revision: number }
  /** Never the approval token. */
  | { type: 'proposal'; id: string; hash: string; preview: Json }
  | { type: 'action.updated'; id: string; status: string }
  | {
      type: 'usage';
      step: number;
      input_tokens: number;
      output_tokens: number;
      cache_read_tokens: number;
      cache_write_tokens: number;
      cost_usd_micro: number;
      conversation_usd_micro: number | null;
      warn: boolean;
    }
  | { type: 'error'; code: string; params?: Readonly<Record<string, string | number>>; reason?: string }
  | { type: 'done'; reason: DoneReason; resumable: boolean };

/** A sink for stream events. It may throw (a closed connection); the loop swallows that and keeps working. */
export type EventSink = (event: AgentStreamEvent) => void;

// ─── The tool runtime port ───────────────────────────────────────────

/** What a tool run adds beyond the result the model sees. */
export interface ToolRunExtras {
  /** Events for the stream (`card`, `plan.updated`, `proposal`, `action.updated`), emitted after `tool.end`. */
  events?: readonly AgentStreamEvent[];
  /** A projection for the UI, stored in the `ui` column of the tool-results message. No localized prose. */
  ui?: Json;
  /** Ids this call's result showed the model (typed `id()` fields of a read): recorded as seen by the conversation (provenance, plan 6.3). */
  refs?: readonly NewRef[];
}

export type ToolRunResult = ToolResult & ToolRunExtras;

/**
 * What a D tool needs to run a route as the admin who sent THIS request (plan 3.3, spike S1): the session that
 * `authAndRecord()` returned on the chat request, and the inbound request for its client-address headers. Carried by
 * reference from the route to the tool runner and nowhere else: never logged, persisted, put in a message, an event, a
 * usage row or the model port.
 */
export type TurnDispatch = Pick<DispatchContext, 'session' | 'inbound'>;

export interface ToolCallContext {
  adminId: AdminId;
  adminName: string;
  conversationId: string;
  /** The model's `tool_use` id: the idempotency key of a D write. */
  toolUseId: string;
  /** 1-based step of this turn. */
  step: number;
  now: () => Date;
  timeZone: string;
  locale: Locale;
  /** The conversation's pinned versions, for the audit context of D writes. */
  model: string;
  effort: string;
  systemPromptVersion: string;
  toolRegistryVersion: string;
  /** 16 hex characters of the SHA-256 of the admin message this turn answers (the audit's `user_text_hash`). */
  userTextHash: string | null;
  /** The request's verified session and inbound request, for a D tool that dispatches a route. Absent: such a tool writes nothing. */
  dispatch?: TurnDispatch;
}

/**
 * Runs one tool call of a tool set. R and P tools are the registry's; the stage-only D, B and G tools are bound by the
 * caller (the Plan, the draft routes through dispatch, staging). A runtime never throws for a failed call: it answers a
 * catalogued `ToolError`. The loop treats a throw as `agent_harness_error`.
 */
export interface ToolRuntime {
  run(set: ToolSet, call: { name: string; input: unknown }, ctx: ToolCallContext): Promise<ToolRunResult>;
}

// ─── Dependencies ────────────────────────────────────────────────────

/** The part of the store the loop uses. */
export interface LoopStore {
  conversations: Pick<AdminAgentStore['conversations'], 'getConversation' | 'acquireTurnLease' | 'releaseTurnLease' | 'updateConversation'>;
  messages: Pick<AdminAgentStore['messages'], 'appendMessage' | 'loadHistory'>;
  usage: Pick<AdminAgentStore['usage'], 'reserveUsage' | 'settleUsage' | 'releaseUsage' | 'getSpend'>;
  plans: Pick<AdminAgentStore['plans'], 'getActivePlan'>;
  /** Provenance of ids (plan 6.3): what a read returned and what the admin typed is recorded, so a write may name it. */
  refs: Pick<AdminAgentStore['refs'], 'recordRefs'>;
  proposals: Pick<AdminAgentStore['proposals'], 'listPendingProposals'>;
}

export interface SystemPrompt {
  text: string;
  /** Hash of the text: stored on the conversation as `system_prompt_version`. */
  version: string;
}

export interface LoopDeps {
  store: LoopStore;
  port: AdminModelPort;
  tools: ToolRuntime;
  buildToolSet(input: { role: ToolRole; maxPhase: AdminAgentPhase }): ToolSet;
  systemPrompt: SystemPrompt;
  config(): AdminAgentConfig;
  /** Fire-and-forget audit writer (`logAuditEvent`). */
  audit(entry: AuditLogEntry): void;
  now(): Date;
  /** The per-conversation harness sentinel; only called when the `sentinel-user` channel is in use. */
  sentinelFor(conversationId: string): string;
  /** Server-built short codes for entities changed outside the chat (the drift protocol); optional. */
  drift?(input: { adminId: AdminId; conversationId: string }): Promise<readonly string[]>;
  /** The channel the port renders harness events with; the loop needs it to strip the sentinel from admin text. */
  stateChannel: ProviderAdapterConfig['stateChannel'];
  /** The model's context window for the "refuse at N%" rule; defaults to a conservative 200k (spike S4 measures the real one). */
  contextWindowTokens?: number;
}

export type TurnInput = { kind: 'message'; text: string; clientMsgId: string } | { kind: 'continue' };

export interface TurnRequest {
  adminId: AdminId;
  adminName: string;
  conversationId: string;
  input: TurnInput;
  /** The viewer's UI language this turn: the language the assistant replies in. */
  locale: Locale;
  /** IANA zone of the viewer. */
  timeZone: string;
  /** The tool registry the live admin tier selects (`site` or `scoped`). A conversation made for the other one is read-only. */
  role: ToolRole;
  /** The recorded session and inbound request of the chat request (see `TurnDispatch`); absent when no session was recorded. */
  dispatch?: TurnDispatch;
}

export interface TurnOutcome {
  reason: DoneReason;
  resumable: boolean;
  steps: number;
  toolCalls: number;
  stagings: number;
  /** Cost of this turn's model calls, micro-dollars. */
  costUsdMicro: number;
  /**
   * The lowest share of the previous step's prefix that a later step of the turn read back from the cache (1 is a full
   * hit). Absent when the turn had no second step. It is deliberately not on the `done` stream event, which clients pin.
   */
  lowestCacheReadRatio?: number;
}
