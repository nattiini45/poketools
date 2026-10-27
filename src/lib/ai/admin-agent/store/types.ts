/**
 * Row shapes the store returns (snake_case, as the database types) and the inputs of its writes. Columns are listed
 * explicitly (`columns.ts`); a record never carries `token_hash`, `approved_ip_hash` or `approved_user_agent`.
 */
import type { Json, Tables } from '@/types/database';

export type { Json };

export type ConversationRecord = Tables<'admin_agent_conversations'>;
export type MessageRecord = Tables<'admin_agent_messages'>;
export type PlanRecord = Tables<'admin_agent_plans'>;
export type PlanRevisionRecord = Tables<'admin_agent_plan_revisions'>;
export type ActionRecord = Tables<'admin_agent_actions'>;
export type RefRecord = Tables<'admin_agent_refs'>;
export type SnapshotRecord = Tables<'admin_agent_snapshots'>;

type ProposalRow = Tables<'admin_agent_proposals'>;
/** A proposal as the app reads it: no token hash, no approval fingerprint. */
export type ProposalRecord = Omit<ProposalRow, 'token_hash' | 'approved_ip_hash' | 'approved_user_agent'>;
/** The list shape: without `steps` (up to 1 MiB; read one proposal to get them). */
export type ProposalSummary = Omit<ProposalRecord, 'steps'>;

export type ConversationStatus = 'active' | 'archived';
export type ToolSet = 'site' | 'scoped';
export type UiLocale = 'en' | 'de';
export type MessageRole = 'user' | 'assistant' | 'system';
export type MessageKind = 'chat' | 'tool_results' | 'harness_event';
export type PlanMode = 'create' | 'amend';
export type PlanStatus = 'drafting' | 'ready' | 'building' | 'partial' | 'built' | 'abandoned';
export type PlanAuthor = 'agent' | 'admin' | 'system';
export type ProposalKind = 'build' | 'action' | 'undo';
/** B = reversible live rows, G = outward-facing or irreversible (the column is `class`; the plan calls it tier). */
export type ProposalClass = 'B' | 'G';
export type ProposalStatus = 'proposed' | 'executing' | 'completed' | 'partial' | 'failed' | 'declined' | 'expired' | 'superseded' | 'stale' | 'unknown';
/** The states an executing proposal ends in. */
export type ProposalFinalStatus = 'completed' | 'partial' | 'failed' | 'stale' | 'unknown';
export type ActionClass = 'D' | 'B' | 'G';
export type ActionStatus = 'executing' | 'ok' | 'failed' | 'unknown' | 'skipped' | 'undone';
export type RefSource = 'user_message' | 'tool_result' | 'proposal_step';
export type UsagePurpose = 'turn' | 'title' | 'judge';

export interface NewConversation {
  adminName: string;
  uiLocale: UiLocale;
  /** A validated seed only: a whitelisted key plus ids, never free text. */
  context?: Json;
  /** Pinned for the life of the conversation. */
  model: string;
  effort: string;
  toolSet: ToolSet;
  toolRegistryVersion: string;
  systemPromptVersion: string;
}

export interface NewMessage {
  role: MessageRole;
  kind: MessageKind;
  /** The exact model content blocks (thinking included). */
  content: Json;
  ui?: Json | null;
  model?: string | null;
  stopReason?: string | null;
  usage?: Json | null;
  /** A retried POST with the same id returns the stored message (`duplicate: true`). */
  clientMsgId?: string | null;
}

export interface AppendedMessage {
  message: MessageRecord;
  duplicate: boolean;
}

export interface NewPlan {
  conversationId: string;
  mode: PlanMode;
  doc: Json;
  /** sha256 hex of the canonical document. */
  docHash: string;
  author?: PlanAuthor;
}

export interface PlanRevisionWrite {
  /** The revision the writer read; the write succeeds only if the plan is still at it. */
  expectedRevision: number;
  doc: Json;
  docHash: string;
  /** The patch that produced `doc`, kept in the revision history. */
  patch?: Json | null;
  author: PlanAuthor;
  /** A status change in the same statement (for example `ready` once the plan is complete). */
  status?: PlanStatus;
}

export interface PlanRevisionWritten {
  plan: PlanRecord;
  /** Pending Build proposals of this plan that the new revision superseded (plan 4.3). */
  supersededProposals: number;
}

export interface NewProposal {
  /**
   * The proposal's id when the caller needs it before the insert: `args_hash` covers the proposal id (plan 4.5), so the
   * staging code generates the uuid, hashes with it and inserts under it. Omitted: the database generates one.
   */
  id?: string;
  conversationId: string;
  kind: ProposalKind;
  class: ProposalClass;
  planId?: string | null;
  planRevision?: number | null;
  toolRegistryVersion: string;
  steps: Json;
  proposalHash: string;
  preview: Json;
  previewHash: string;
  /** sha256 hex of the approval token. The store never sees the token. */
  tokenHash: string;
  acksRequired?: Json;
  expiresAt: Date;
  /** Tool plus target: staging it again supersedes the older pending proposal. */
  supersedeKey?: string | null;
  locale: UiLocale;
  /** Refuse (`agent_cap_reached`) when the conversation already has this many pending proposals. */
  maxPending?: number;
}

export interface ProposalClaim {
  /** sha256 hex of the token the approve request carried. */
  tokenHash: string;
  /** Keyed hash of the client IP (never the address). */
  ipHash?: string | null;
  userAgent?: string | null;
}

export interface NewAction {
  conversationId: string;
  /** D calls: the model's tool_use id (unique per conversation). */
  toolUseId?: string | null;
  toolName: string;
  class: ActionClass;
  /** Build and change steps: the proposal and the step key (unique together). Both or neither. */
  proposalId?: string | null;
  stepKey?: string | null;
  method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE' | null;
  path?: string | null;
  args: Json;
  /** sha256 hex of the canonical request. */
  argsHash: string;
}

export interface ActionOutcome {
  status?: ActionStatus;
  httpStatus?: number | null;
  outcomeKind?: string | null;
  errorCode?: string | null;
  result?: Json | null;
  before?: Json | null;
  after?: Json | null;
  afterFingerprint?: string | null;
  undo?: Json | null;
  reversibility?: string | null;
  verify?: Json | null;
  entityType?: string | null;
  entityId?: string | null;
}

export type InsertedAction = { inserted: true; action: ActionRecord } | { inserted: false };

export interface NewRef {
  kind: string;
  id: string;
  label?: string | null;
  source: RefSource;
}

export interface UsageMeters {
  inputTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
}

/** The caps a reservation is checked against, in micro-dollars. Defaults to the `ADMIN_AGENT_BUDGET_*` env. */
export interface UsageCaps {
  conversationMicro: number;
  adminDayMicro: number;
  adminMonthMicro: number;
  globalDayMicro: number;
}

export type UsageCapName = 'conversation' | 'admin_day' | 'admin_month' | 'global_day';

export interface UsageReservation {
  adminName: string;
  /** The conversation the call belongs to; `null` for a title or hint call outside one. */
  conversationId: string | null;
  purpose: UsagePurpose;
  model: string;
  /** Estimated cost of the call, whole micro-dollars. */
  estimateUsdMicro: number;
  caps?: UsageCaps;
}

export type ReserveUsageResult =
  | { ok: true; usageId: string }
  | { ok: false; exceeded: UsageCapName; usedMicro: number; capMicro: number };

export interface UsageSettlement extends UsageMeters {
  costUsdMicro: number;
  stopReason: string | null;
}

export interface SpendSummary {
  /** Settled cost plus unsettled reservations, micro-dollars. */
  conversationMicro: number | null;
  adminDayMicro: number;
  adminMonthMicro: number;
  /** True when a read hit its row bound (the sums are then lower bounds). */
  truncated: boolean;
}

export type BlastCounter = 'league_creates' | 'tournament_creates' | 'ruleset_creates' | 'format_creates' | 'golive_executions' | 'pin_targets';

export interface BlastClaim {
  counter: BlastCounter;
  amount: number;
  cap: number;
}

export type ClaimBudgetResult = { ok: true } | { ok: false; counter: string; value: number; cap: number };

export type TurnLeaseResult =
  | { ok: true; leaseUntil: string }
  | { ok: false; reason: 'conversation_busy' | 'admin_busy' | 'not_found' };
