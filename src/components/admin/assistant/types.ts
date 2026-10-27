/**
 * The shapes the assistant's routes send and the UI renders (spec §18, plan 5.3 to 5.7). Plain data: no server import, so
 * the routes' projections (`src/app/api/admin/agent/_lib/views.ts`) and the client components share one definition.
 *
 * Nothing here is translated text. The conversation's messages are the admin's own words and the assistant's own prose;
 * every other label is a key the UI translates at view time.
 */
import type { PlanSection } from '@/lib/ai/admin-agent/plans/readiness';
import type { CardView } from '@/lib/ai/admin-agent/proposals/stage';

export type { CardView, PlanSection };

/** A whitelisted key plus ids, never free text (plan 5.2). The server validates every id with its guard. */
export const SEED_AREAS = ['admin', 'leagues', 'league', 'rulesets', 'formats', 'tournaments', 'tournament'] as const;
export type SeedArea = (typeof SEED_AREAS)[number];
export const SEED_KEYS = ['new_league', 'describe_ruleset', 'describe_format', 'new_tournament', 'readiness'] as const;
export type SeedKey = (typeof SEED_KEYS)[number];
export const SEED_TABS = ['overview', 'participants', 'phases', 'format', 'draft', 'settings'] as const;
export type SeedTab = (typeof SEED_TABS)[number];

export type ConversationSeed = {
  area: SeedArea;
  seed?: SeedKey;
  entity?: string;
  tab?: SeedTab;
};

export interface ConversationSummary {
  id: string;
  /** The model-written title, rendered as data. */
  title: string | null;
  status: 'active' | 'archived';
  /** The admin's tier changed away from the tool set the conversation was made with: start a new one. */
  readOnly: boolean;
  /** A turn is running right now (this tab or another). */
  busy: boolean;
  context: ConversationSeed | null;
  createdAt: string;
  lastMessageAt: string;
  version: number;
}

export interface ConversationList {
  items: ConversationSummary[];
  total: number;
  limit: number;
  offset: number;
}

export type ToolStatus = 'ok' | 'failed' | 'pending';

export const CLARIFICATION_KINDS = ['choice', 'multi', 'text', 'date', 'player_pick', 'number'] as const;
export type ClarificationKindValue = (typeof CLARIFICATION_KINDS)[number];

/** A structured question the assistant put to the admin (`request_clarification`). Assistant-written text, rendered as data. */
export interface ClarificationView {
  kind: ClarificationKindValue;
  question: string;
  options: Array<{ value: string; label: string }>;
}

/** One row of the transcript. Thinking blocks and tool inputs are never part of it. */
export type TranscriptItem =
  | { type: 'user'; seq: number; at: string; text: string | null }
  | { type: 'assistant'; seq: number; at: string; text: string | null }
  | { type: 'tool'; seq: number; id: string; name: string; status: ToolStatus; code: string | null; proposalId: string | null; clarification?: ClarificationView }
  | { type: 'event'; seq: number; at: string; event: string; proposalId: string | null };

export type PlanStatusValue = 'drafting' | 'ready' | 'building' | 'partial' | 'built' | 'abandoned';

/** One value of a Plan panel row. Structured, never translated text: the panel formats and translates it at view time. */
export type PlanRowValue =
  | { kind: 'text'; text: string }
  | { kind: 'number'; value: number }
  | { kind: 'bool'; value: boolean }
  /** A `YYYY-MM-DD` calendar day. */
  | { kind: 'date'; value: string }
  /** A DB enum, labelled by the shared `enums` namespace. */
  | { kind: 'enum'; group: 'bracketType' | 'formatType' | 'draftType' | 'teamVisibility'; value: string }
  /** A word of the panel's own catalog: `plan.<group>.<value>`. */
  | { kind: 'word'; group: 'modes' | 'engines' | 'groupModes' | 'languages'; value: string }
  | { kind: 'phase'; bracket: string; bestOf: number; doubles: boolean }
  | { kind: 'matched'; resolved: number; total: number };

export interface PlanRow {
  /** A key under `plan.rows` of the chrome catalog. */
  label: string;
  value: PlanRowValue;
}

export type PlanSectionState = 'empty' | 'ready' | 'needs_input' | 'assumed' | 'engine_gap' | 'built';

export interface PlanSectionView {
  section: Exclude<PlanSection, 'plan'>;
  state: PlanSectionState;
  /** Blockers that count against a build (`fact` blockers are checked at Build time and not counted here). */
  blockers: number;
  rows: PlanRow[];
  /** Repeated parts of the section (phases, draft pools); `title` is stored text such as a phase name. */
  items: Array<{ title: string | null; rows: PlanRow[] }>;
}

export interface PlanBlockerView {
  /** A key under `blockers` of the cards catalog. */
  code: string;
  section: PlanSection;
  /** RFC 6901 pointer to the field that fixes it. */
  path: string;
  params: Record<string, string | number | boolean>;
}

export interface PlanAssumptionView {
  key: string;
  source: 'admin' | 'default' | 'inferred';
  confirmed: boolean;
  value: PlanRowValue | null;
}

export interface PlanView {
  id: string;
  mode: 'create' | 'amend';
  status: PlanStatusValue;
  revision: number;
  /** The first 8 hex of the document hash: the code a Build card shows. */
  code: string;
  /** Assistant-written; rendered as data. */
  title: string;
  contentLocale: 'en' | 'de';
  sections: PlanSectionView[];
  assumptions: PlanAssumptionView[];
  /** True when no blocker counts against a build. */
  ready: boolean;
  blockers: PlanBlockerView[];
  warnings: PlanBlockerView[];
}

export type ProposalStatusValue =
  | 'proposed'
  | 'executing'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'declined'
  | 'expired'
  | 'superseded'
  | 'stale'
  | 'unknown';

export interface ProposalSummaryView {
  id: string;
  kind: 'build' | 'action' | 'undo';
  class: 'B' | 'G';
  status: ProposalStatusValue;
  /** `expired` once a `proposed` card is past its expiry, before the next sweep writes it. */
  effectiveStatus: ProposalStatusValue;
  planCode: string;
  createdAt: string;
  expiresAt: string;
}

export interface ConversationDetail {
  conversation: ConversationSummary;
  items: TranscriptItem[];
  /** The history hit the read bound: older rows are not shown. */
  truncated: boolean;
  plan: PlanView | null;
  proposals: ProposalSummaryView[];
  /** A harness event is waiting for the model: offer "Continue". */
  awaitingContinue: boolean;
  limits: { maxTextChars: number; conversationCapMicro: number; conversationWarnMicro: number };
  capabilities: {
    /** The approve route executes (phase 1 and later). Phase 0 answers 501 `phase_disabled`. */
    approve: boolean;
    maxPhase: number;
  };
}

/** `GET /proposals/[id]`: the frozen card and, while it waits, the approval token (for the owning admin only). */
export interface ProposalDetail {
  card: CardView;
  token: string | null;
}

/** The stream events of the chat route, as the client reads them (mirrors `AgentStreamEvent` of the loop). */
export type AgentEvent =
  | { type: 'text.delta'; step: number; delta: string }
  | { type: 'tool.start'; id: string; name: string; label_code: string }
  | { type: 'tool.end'; id: string; name: string; ok: boolean; code?: string }
  | { type: 'card'; kind: string; ref: string }
  | { type: 'plan.updated'; revision: number }
  | { type: 'proposal'; id: string; hash: string; preview: unknown }
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
  | { type: 'error'; code: string; params?: Record<string, string | number>; reason?: string }
  | { type: 'done'; reason: string; resumable: boolean };
