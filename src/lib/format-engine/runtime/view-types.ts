/**
 * The shapes the live-format surfaces send over the wire: the player's view of a running kit league (`GET .../format/me`),
 * the admin overview, the adjustment and check pages. Types and a few `as const` lists only, so a client component and a
 * route handler share them. Client-safe: no zod, no server module (the type imports are erased).
 *
 * Privacy contract (docs/format-kit.md, "Live format routes"; the full list is in `views.ts`): every DTO is built by a pure mapper that copies named fields. A DTO never has a member
 * called `status` (a `players` column; the private-player-data test helper forbids it in a body), so every state is
 * `state`. No DTO carries a row id of `format_action_submissions`, `format_resource_items` or `format_relation_links`, a
 * `source_ref`, a seed, or another player's picks.
 */
import type { Json } from '@/types/database';
import type { LText } from '@/lib/studio-core/ltext';
import type { FormatCheckSource } from '@/lib/supabase/queries/format-runtime';
import type { ActionIssue } from './actions';
import type { ActionPick } from './types';

// ─── Player view ────────────────────────────────────────────────────────────────────────────────

/** `name: null` = a player who is not a current participant of the league ("former player"). */
export interface PlayerRef {
  id: string;
  name: string | null;
}

export interface EntryView {
  /** @pkmn species id (display via `<PkmnName kind="species">`). */
  id: string;
  attrs: { key: string; value: string | number | boolean | string[] }[];
}

/** The pick domains of the actionable steps, each ONCE (not per step). Only domains whose entries the viewer may see. */
export interface DomainEntriesView {
  key: string;
  label: LText;
  entries: EntryView[];
}

/**
 * A pool (domain) the viewer may know about, with whether it is open yet. Unlike `domains` it also lists a pool that no
 * actionable step draws from (a locked one, one outside any step) and carries no entries; an `admins` domain is never listed.
 */
export interface PoolView {
  key: string;
  label: LText;
  unlocked: boolean;
}

/**
 * `taken` = another player holds this item of a globally exclusive resource (any visibility; the submit would answer
 * `resource_item_taken`). It names no holder, is never set for the viewer's own current pick, and only appears on entries
 * the viewer may see.
 */
export interface BlockedEntry {
  id: string;
  reason: 'not_eligible' | 'taken';
}

export interface StepView {
  index: number;
  resource: string;
  resource_label: LText;
  domain: string;
  domain_label: LText;
  count: number;
  distinct_attr: string | null;
  unlocked: boolean;
  /** `[]` unless the step is actionable. */
  blocked: BlockedEntry[];
}

/** `locked` = the flag says so; `open` = the flag says so or there is no `opens_on`; `not_open_yet` = `opens_on` has not fired. */
export type ActionWindow = 'open' | 'locked' | 'not_open_yet';

export const SUBMISSION_STATES = ['draft', 'submitted', 'locked'] as const;
export type SubmissionState = (typeof SUBMISSION_STATES)[number];

export interface SubmissionView {
  state: SubmissionState;
  picks: ActionPick[];
}

export interface ActionView {
  id: string;
  label: LText;
  window: ActionWindow;
  lock: 'on_submit' | 'on_close';
  /** The actor has the link / is on the roster / is a participant. */
  accessible: boolean;
  /** `accessible && window === 'open' && submission?.state !== 'locked'`. */
  actionable: boolean;
  /** Only when `visibleLinks` lets the viewer see the `to` side. */
  target: PlayerRef | null;
  /** The action is `via` a relation whose `to` side the viewer may not see. */
  target_hidden: boolean;
  steps: StepView[];
  /** The viewer's own. */
  submission: SubmissionView | null;
}

/** `holder` only for resources with visibility `all`, and never for the viewer's own items. */
export interface ItemView {
  resource: string;
  resource_label: LText;
  item_id: string | null;
  amount: number;
  holder: PlayerRef | null;
}

export interface RelationLinkView {
  from: PlayerRef | null;
  to: PlayerRef | null;
  revealed: boolean;
}

export type RelationShape = 'derangement' | 'pairs' | 'manual';

export interface RelationView {
  key: string;
  label: LText;
  shape: RelationShape;
  links: RelationLinkView[];
}

export const CHALLENGE_STATES = ['open', 'accepted', 'declined', 'expired', 'cancelled'] as const;
export type ChallengeState = (typeof CHALLENGE_STATES)[number];

export interface ChallengeView {
  id: string;
  phase_id: string;
  challenger: PlayerRef;
  defender: PlayerRef;
  state: ChallengeState;
  /** State `open` but `expires_at` has passed (the cron has not marked it yet). */
  lapsed: boolean;
  round: number;
  created_at: string;
  expires_at: string;
  responded_at: string | null;
  match_id: string | null;
}

export interface LadderView {
  phase_id: string;
  stage_key: string;
  stage_label: LText | null;
  /** The highest non-completed round; `null` = no open round. */
  round: number | null;
  config: { rank_range: number; max_open: number; cooldown_rounds: number; accept_window_hours: number };
  table: { player: PlayerRef; rank: number }[];
  my_rank: number | null;
  /** Ids from `challengeTargets()` (`format-engine/challenge.ts`, which returns `LadderRow[]`, mapped to ids): a hint, the database decides. */
  targets: string[];
  /** The viewer's own challenges. */
  challenges: ChallengeView[];
}

export type PlayerFormatView =
  | { running: false }
  | {
      running: true;
      actions: ActionView[];
      domains: DomainEntriesView[];
      /** Every non-admin pool with its lock state, so the teambuilder can say which pools are open this week. */
      pools: PoolView[];
      items: ItemView[];
      relations: RelationView[];
      ladders: LadderView[];
    };

// ─── Admin ──────────────────────────────────────────────────────────────────────────────────────

export interface AdminActionView {
  id: string;
  label: LText;
  window: ActionWindow;
  lock: 'on_submit' | 'on_close';
  /** Players who CAN act: current participants with a link (`via`) or on the roster. */
  actors: number;
  /** Over those actors, so `missing` can reach 0. */
  counts: { missing: number; draft: number; submitted: number; locked: number };
}

export interface AdminDomainView {
  key: string;
  label: LText;
  visibility: 'public' | 'when_unlocked' | 'admins';
  unlocked: boolean;
  entry_count: number;
}

/** `link_count` is always sent; `links` follow `visibleLinks` (masked by default). */
export interface AdminRelationView extends RelationView {
  masked: boolean;
  link_count: number;
}

/** The history shows all seven kinds. */
export const ADJUST_KINDS = ['points', 'resource', 'relation', 'outcome', 'action', 'domain', 'rank'] as const;
export type AdjustKind = (typeof ADJUST_KINDS)[number];

/** What `POST .../adjustments` accepts: `outcome` is record-only in the lib and is not exposed (docs/format-kit.md, "Live format routes"). */
export type SubmittableAdjustKind = Exclude<AdjustKind, 'outcome'>;
export const SUBMITTABLE_ADJUST_KINDS = ['points', 'resource', 'relation', 'action', 'domain', 'rank'] as const satisfies readonly SubmittableAdjustKind[];

export interface AdminOverview {
  /** `false`: the engine is not `kit` or the league has no format. */
  running: boolean;
  actions: AdminActionView[];
  domains: AdminDomainView[];
  /** Masked. */
  relations: AdminRelationView[];
  open_checks: number;
  open_challenges: number;
  allowed_adjustments: SubmittableAdjustKind[];
}

/** The response of `POST .../relations/unmask` (an audited, explicit admin read). No picks, no item rows. */
export interface AdminUnmasked {
  /** `masked: false`. */
  relations: AdminRelationView[];
  submissions: {
    action: string;
    rows: { player: PlayerRef; state: SubmissionState; target: PlayerRef | null }[];
  }[];
}

export type CheckState = 'open' | 'confirmed' | 'rejected';

export interface CheckView {
  id: string;
  /** The UI renders an unknown source with a generic sentence. */
  source: FormatCheckSource | string;
  rule_id: string;
  rule_label: LText | null;
  subject: Json;
  state: CheckState;
  note: string | null;
  opened_at: string;
  resolved_at: string | null;
  resolved_by: PlayerRef | null;
}

export interface AdjustmentView {
  id: string;
  kind: AdjustKind;
  target: Json;
  /** A relation adjustment's `links` are replaced by `{ link_count }`. */
  delta: Json;
  reason: string;
  admin: PlayerRef | null;
  created_at: string;
}

export interface AdjustmentTargets {
  /** `rosterOf(ctx, stage.key)`. */
  stages: { key: string; label: LText | null; players: PlayerRef[] }[];
  players: PlayerRef[];
  /** `items` = the current entry ids of the held domain (admin view). */
  resources: { key: string; label: LText; holds_domain: string | null; exclusive: boolean; items: string[] }[];
  relations: { key: string; label: LText; has_links: boolean }[];
  actions: { id: string; label: LText }[];
}

export interface AdjustmentsPage {
  allowed: SubmittableAdjustKind[];
  targets: AdjustmentTargets;
  history: AdjustmentView[];
  total: number;
}

export interface ChecksPage {
  checks: CheckView[];
  total: number;
}

// ─── Concrete response payloads (inside the `ApiResult<T>` envelope) ───────────────────────────────

/** `PUT .../actions/{id}` and `POST .../actions/{id}/submit`. */
export interface SubmissionResponse {
  submission: SubmissionView;
}

/** `POST .../challenges` (201), `POST .../challenges/{id}/answer` and `DELETE .../challenges/{id}`. */
export interface ChallengeResponse {
  challenge: ChallengeView;
}

/** `POST .../adjustments` (201). */
export interface AdjustmentCreated {
  adjustment_id: string;
}

export type CheckVerdict = 'confirmed' | 'rejected';

/** `POST .../checks/{id}/resolve`. */
export interface CheckResolved {
  check_id: string;
  state: CheckVerdict;
}

/**
 * The body of a rejected action submission (`format_action_invalid`): the problems come next to the usual error members.
 * It is the one failure whose body has more than `{ error, code, params }`.
 */
export interface ActionIssuesBody {
  issues: ActionIssue[];
}
