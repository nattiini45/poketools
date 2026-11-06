/**
 * Queries behind the runtime state of a custom format (`format_*` tables, 20261105090000_format_runtime.sql).
 * Server only.
 *
 * `getFormatRuntime` reads all nine tables of one league in a single wave, each paged under PostgREST `max_rows`
 * (`readBoundedPages`: a table of at most 1,000 rows costs one request). The writes are the Postgres functions of the
 * migration, one transaction each; the planner (TS) builds the `FormatOp` list, the database applies it in order. The
 * domain signals of those functions (`P0001`, message = code) leave this module as `FormatRuntimeError`; anything
 * else goes through `mapFormatDbError` and is rethrown unchanged when it is not a format signal.
 */
import 'server-only';

import { supabase } from '../client';
import { readBoundedPages } from '../read-bounded-pages';
import type { Json, Tables } from '@/types/database';
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { mapFormatDbError } from '@/lib/format-studio/errors';
import { parseDbError } from '@/lib/studio-core/db-errors';
import { isValidUuid } from '@/lib/utils/uuid';
import type { FormatOp, RuntimeCheck } from '@/lib/format-engine/runtime/types';

export type FormatRelationLinkRow = Tables<'format_relation_links'>;
export type FormatResourceItemRow = Tables<'format_resource_items'>;
export type FormatActionSubmissionRow = Tables<'format_action_submissions'>;
export type FormatEventLogRow = Tables<'format_event_log'>;
export type FormatFlagRow = Tables<'format_flags'>;
export type FormatPlayerAttrRow = Tables<'format_player_attrs'>;
export type FormatTrackProgressRow = Tables<'format_track_progress'>;
export type FormatCheckRow = Tables<'format_checks'>;
export type FormatAdjustmentRow = Tables<'format_adjustments'>;

export type FormatAdjustmentKind = 'points' | 'resource' | 'relation' | 'outcome' | 'action' | 'domain' | 'rank';
export type FormatCheckSource = RuntimeCheck['source'];
export type FormatSubmissionStatus = 'draft' | 'submitted' | 'locked';

export type { FormatOp };

/** One item a submitted action grants to its target (or its actor when there is no target). */
export interface FormatActionItem {
  resource: string;
  item_id: string | null;
  exclusive: boolean;
}

export interface FormatRuntime {
  relationLinks: FormatRelationLinkRow[];
  resourceItems: FormatResourceItemRow[];
  actionSubmissions: FormatActionSubmissionRow[];
  eventLog: FormatEventLogRow[];
  flags: FormatFlagRow[];
  playerAttrs: FormatPlayerAttrRow[];
  trackProgress: FormatTrackProgressRow[];
  checks: FormatCheckRow[];
  adjustments: FormatAdjustmentRow[];
}

const EMPTY_RUNTIME = (): FormatRuntime => ({
  relationLinks: [],
  resourceItems: [],
  actionSubmissions: [],
  eventLog: [],
  flags: [],
  playerAttrs: [],
  trackProgress: [],
  checks: [],
  adjustments: [],
});

/** Every row of one league's table, paged; `page` must order by a unique total order and end in `.range()`. */
async function readRows<T>(
  label: string,
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const { rows } = await readBoundedPages(page, { label: `format-runtime ${label}` });
  return rows;
}

/** The runtime state of a league's format: all nine tables, one read wave. */
export async function getFormatRuntime(seasonId: string): Promise<FormatRuntime> {
  if (!isValidUuid(seasonId)) return EMPTY_RUNTIME();
  const [relationLinks, resourceItems, actionSubmissions, eventLog, flags, playerAttrs, trackProgress, checks, adjustments] =
    await Promise.all([
      readRows<FormatRelationLinkRow>('format_relation_links', (from, to) =>
        supabase.from('format_relation_links').select('*').eq('season_id', seasonId)
          .order('relation_key').order('from_player_id').range(from, to)),
      readRows<FormatResourceItemRow>('format_resource_items', (from, to) =>
        supabase.from('format_resource_items').select('*').eq('season_id', seasonId)
          .order('player_id').order('created_at').order('id').range(from, to)),
      readRows<FormatActionSubmissionRow>('format_action_submissions', (from, to) =>
        supabase.from('format_action_submissions').select('*').eq('season_id', seasonId)
          .order('action_key').order('actor_player_id').range(from, to)),
      readRows<FormatEventLogRow>('format_event_log', (from, to) =>
        supabase.from('format_event_log').select('*').eq('season_id', seasonId)
          .order('fired_at').order('event_key').range(from, to)),
      readRows<FormatFlagRow>('format_flags', (from, to) =>
        supabase.from('format_flags').select('*').eq('season_id', seasonId).order('key').range(from, to)),
      readRows<FormatPlayerAttrRow>('format_player_attrs', (from, to) =>
        supabase.from('format_player_attrs').select('*').eq('season_id', seasonId)
          .order('player_id').order('attr_key').range(from, to)),
      readRows<FormatTrackProgressRow>('format_track_progress', (from, to) =>
        supabase.from('format_track_progress').select('*').eq('season_id', seasonId)
          .order('player_id').order('track_key').range(from, to)),
      readRows<FormatCheckRow>('format_checks', (from, to) =>
        supabase.from('format_checks').select('*').eq('season_id', seasonId)
          .order('opened_at').order('dedupe_key').range(from, to)),
      readRows<FormatAdjustmentRow>('format_adjustments', (from, to) =>
        supabase.from('format_adjustments').select('*').eq('season_id', seasonId)
          .order('created_at').order('id').range(from, to)),
    ]);
  return { relationLinks, resourceItems, actionSubmissions, eventLog, flags, playerAttrs, trackProgress, checks, adjustments };
}

// ---------------------------------------------------------------------------------------------------------------
// Errors

/** The longest adjustment reason (`format_adjustments_reason_length`: 1..500 characters after trimming). */
export const FORMAT_ADJUSTMENT_REASON_MAX = 500;

export const FORMAT_RUNTIME_ERROR_CODES = [
  'action_locked',
  'resource_item_taken',
  'domain_amendment_locked',
  'reason_required',
  'reason_too_long',
] as const;
export type FormatRuntimeErrorCode = (typeof FORMAT_RUNTIME_ERROR_CODES)[number];

const FORMAT_RUNTIME_ERROR_STATUS: { readonly [C in FormatRuntimeErrorCode]: number } = {
  action_locked: 409,
  resource_item_taken: 409,
  domain_amendment_locked: 409,
  reason_required: 400,
  reason_too_long: 400,
};

/** A refusal of the runtime functions that the viewer can act on; `safeErrorResponse` passes its code and text. */
export class FormatRuntimeError<C extends FormatRuntimeErrorCode = FormatRuntimeErrorCode> extends UserFacingError<C> {
  constructor(code: C) {
    super(errorsSeasons.en[code], { code, status: FORMAT_RUNTIME_ERROR_STATUS[code] });
    this.name = 'FormatRuntimeError';
  }
}

const RUNTIME_SIGNALS: ReadonlySet<string> = new Set<FormatRuntimeErrorCode>(FORMAT_RUNTIME_ERROR_CODES);

function isRuntimeCode(message: string): message is FormatRuntimeErrorCode {
  return RUNTIME_SIGNALS.has(message);
}

/**
 * Maps a PostgREST error of the runtime functions to a typed error. It matches the SQLSTATE and the exception message
 * (the code the function raised), never text a user typed. Anything else (`invalid_op` is a planner bug and stays raw)
 * goes through `mapFormatDbError`, which returns an unknown error unchanged, so a caller may always throw the result.
 */
export function mapFormatRuntimeDbError(error: unknown): unknown {
  const signal = parseDbError(error);
  if (signal?.code === 'P0001' && signal.message !== undefined && isRuntimeCode(signal.message)) {
    return new FormatRuntimeError(signal.message);
  }
  // A reason the application did not length-check (an op of a rule) reaches the table's check constraint.
  if (signal?.code === '23514' && signal.constraint === 'format_adjustments_reason_length') {
    return new FormatRuntimeError('reason_too_long');
  }
  return mapFormatDbError(error);
}

/** The changes `format_apply_adjustment` refuses instead of recording them as done (the ops would skip them silently). */
export const FORMAT_ADJUSTMENT_REFUSALS = ['relation_has_links', 'insufficient_holding'] as const;
export type FormatAdjustmentRefusal = (typeof FORMAT_ADJUSTMENT_REFUSALS)[number];

/**
 * `format_apply_adjustment` refused the change under its own lock: a concurrent request took the relation's links or the
 * units first, after the caller's snapshot was read. Nothing was written. `applyAdjustment` turns it into the matching
 * `AdjustIssue`, so the route answers it like the check against the snapshot.
 */
export class FormatAdjustmentRefusedError extends Error {
  constructor(readonly refusal: FormatAdjustmentRefusal) {
    super(refusal);
    this.name = 'FormatAdjustmentRefusedError';
  }
}

/**
 * `format_action_submit` was asked to write only over a draft (`onlyIfUnsubmitted`) and found a submitted pick: the player
 * committed after the caller read its state. Nothing was written. A pick that is already locked (or a locked action)
 * raises `action_locked` instead, because the function checks the lock first; the caller treats both as "left alone".
 * Only the cron's deadline draw asks, so it never leaves the server as an API answer.
 */
export class FormatActionAlreadySubmittedError extends Error {
  constructor() {
    super('action_already_submitted');
    this.name = 'FormatActionAlreadySubmittedError';
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Writes

/** The generated RPC types mark every parameter non-null although the functions accept NULL for these. */
const nullable = (value: string | null): string => value as string;

export interface FireFormatEventInput {
  seasonId: string;
  /** The idempotency key: the same key fires once. */
  eventKey: string;
  event: string;
  payload: Json;
  ops: readonly FormatOp[];
  firedBy: string | null;
}

/** Logs the event and applies its ops once. True when it fired now, false when the key had fired before. */
export async function fireFormatEvent(input: FireFormatEventInput): Promise<boolean> {
  const { data, error } = await supabase.rpc('format_fire_event', {
    p_season_id: input.seasonId,
    p_event_key: input.eventKey,
    p_event: input.event,
    p_payload: input.payload,
    p_ops: input.ops as unknown as Json,
    p_fired_by: nullable(input.firedBy),
  });
  if (error) throw mapFormatRuntimeDbError(error);
  return data === true;
}

export interface SaveFormatActionInput {
  seasonId: string;
  actionKey: string;
  actorId: string;
  targetId: string | null;
  picks: Json;
}

/** Saves a draft pick. Raises `action_locked` while the action or the actor's submission is locked. */
export async function saveFormatAction(input: SaveFormatActionInput): Promise<FormatActionSubmissionRow> {
  const { data, error } = await supabase.rpc('format_action_save', {
    p_season_id: input.seasonId,
    p_action_key: input.actionKey,
    p_actor: input.actorId,
    p_target: nullable(input.targetId),
    p_picks: input.picks,
  });
  if (error) throw mapFormatRuntimeDbError(error);
  return data;
}

export interface SubmitFormatActionInput extends SaveFormatActionInput {
  /** The items the pick grants, replacing the ones an earlier submission granted. */
  items: readonly FormatActionItem[];
  /** True locks the submission at once (a `lock: on_submit` action). */
  lock: boolean;
  /**
   * True writes only over a draft or a fresh row; a pick already submitted or locked raises
   * `FormatActionAlreadySubmittedError` under the action's lock (the cron's draw must not replace a player's choice).
   */
  onlyIfUnsubmitted?: boolean;
}

/**
 * Submits a pick. Raises `action_locked` or `resource_item_taken` (nothing is written then), and with `onlyIfUnsubmitted`
 * a `FormatActionAlreadySubmittedError` when the pick is already submitted (a locked pick raises `action_locked`).
 */
export async function submitFormatAction(input: SubmitFormatActionInput): Promise<FormatActionSubmissionRow> {
  const { data, error } = await supabase.rpc('format_action_submit', {
    p_season_id: input.seasonId,
    p_action_key: input.actionKey,
    p_actor: input.actorId,
    p_target: nullable(input.targetId),
    p_picks: input.picks,
    p_items: input.items as unknown as Json,
    p_lock: input.lock,
    ...(input.onlyIfUnsubmitted === true ? { p_only_if_unsubmitted: true } : {}),
  });
  if (error) {
    const signal = parseDbError(error);
    if (signal?.code === 'P0001' && signal.message === 'action_already_submitted') throw new FormatActionAlreadySubmittedError();
    throw mapFormatRuntimeDbError(error);
  }
  return data;
}

export interface ApplyFormatAdjustmentInput {
  seasonId: string;
  kind: FormatAdjustmentKind;
  target: Json;
  delta: Json;
  reason: string;
  adminId: string | null;
  ops: readonly FormatOp[];
  /** For kind `domain`: the actions whose lock forbids the amendment. */
  guardActions: readonly string[];
}

/**
 * Records an admin adjustment and applies its ops. Returns the adjustment id. Raises `FormatAdjustmentRefusedError` when
 * the relation already has links or the player holds fewer units than a revoke asks for (nothing is written then).
 */
export async function applyFormatAdjustment(input: ApplyFormatAdjustmentInput): Promise<string> {
  const { data, error } = await supabase.rpc('format_apply_adjustment', {
    p_season_id: input.seasonId,
    p_kind: input.kind,
    p_target: input.target,
    p_delta: input.delta,
    p_reason: input.reason,
    p_admin: nullable(input.adminId),
    p_ops: input.ops as unknown as Json,
    p_guard_actions: [...input.guardActions],
  });
  if (error) {
    const signal = parseDbError(error);
    const refusal = FORMAT_ADJUSTMENT_REFUSALS.find((code) => code === signal?.message);
    if (signal?.code === 'P0001' && refusal !== undefined) throw new FormatAdjustmentRefusedError(refusal);
    throw mapFormatRuntimeDbError(error);
  }
  return data;
}

export interface OpenFormatCheckInput {
  seasonId: string;
  source: FormatCheckSource;
  ruleId: string;
  dedupeKey: string;
  subject: Json;
}

/** Opens a check. The new id, or null when a check with that dedupe key already exists. */
export async function openFormatCheck(input: OpenFormatCheckInput): Promise<string | null> {
  const { data, error } = await supabase.rpc('format_check_open', {
    p_season_id: input.seasonId,
    p_source: input.source,
    p_rule_id: input.ruleId,
    p_dedupe_key: input.dedupeKey,
    p_subject: input.subject,
  });
  if (error) throw mapFormatRuntimeDbError(error);
  return (data as string | null) ?? null;
}

export interface ResolveFormatCheckInput {
  /** The league the check belongs to: a check of another league resolves nothing. */
  seasonId: string;
  checkId: string;
  status: 'confirmed' | 'rejected';
  adminId: string | null;
  note: string | null;
}

/** Resolves an open check of the league. False when it was not open (already resolved, unknown, or of another league). */
export async function resolveFormatCheck(input: ResolveFormatCheckInput): Promise<boolean> {
  const { data, error } = await supabase.rpc('format_check_resolve', {
    p_season_id: input.seasonId,
    p_check_id: input.checkId,
    p_status: input.status,
    p_admin: nullable(input.adminId),
    p_note: nullable(input.note),
  });
  if (error) throw mapFormatRuntimeDbError(error);
  return data === true;
}
