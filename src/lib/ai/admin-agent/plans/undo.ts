/**
 * Undo, computed from what the code can actually reverse (plan 4.7). Each ledger row has an op; `undoability` is
 * re-evaluated live when the admin clicks Undo, and a reason code explains every "no".
 *
 * "Undo build" is a `propose_undo` proposal, the one multi-step G kind (cap 20 steps). `deriveUndoPlan` builds its step
 * list: one reversal per ledger entry the conversation created, in reverse order, each with its own `after_fingerprint`
 * precondition. It never silently skips: every entry ends up in exactly one of
 *   - `steps`        reversals that can run,
 *   - `leftAlone`    changed outside the chat since the assistant wrote it ("left alone: edited outside chat"),
 *   - `residue`      kept on purpose (phases, pools of an archived league) and listed on the card,
 *   - `notUndoable`  with the reason (immutable, outward effect, locked, unknown op).
 * It never includes an entry the ledger did not create, and undo is compensating only: nothing here hard-deletes. There
 * are two carve-outs, both private drafts created in this conversation: a format draft that is unpublished and unattached
 * (Q24), and a ruleset draft that has never been published (spec §18.8: any version makes it residue).
 *
 * Pure: the caller supplies the ledger rows and the live state it read. The route bindings that execute a reversal
 * live in `_ops/g` and are reachable from the executor with a ledger row as input only.
 */

export type LedgerStatus = 'executing' | 'ok' | 'failed' | 'unknown' | 'skipped' | 'undone';

export interface LedgerEntryView {
  actionId: string;
  /** Order of the writes; undo runs newest first. */
  seq: number;
  op: string;
  status: LedgerStatus;
  entityType: string | null;
  entityId: string | null;
  /** The fingerprint the assistant stored when it wrote the entity. */
  afterFingerprint: string | null;
  /** Op-specific discriminator the ledger recorded (`gallery` for a visibility change, for example). */
  variant?: string;
  /** Fields a settings update touched. */
  changedFields?: readonly string[];
}

export interface UndoLockFacts {
  /** A round exists in any phase of the league. */
  roundsExist?: boolean;
  /** The league's groups already have a scheduled round. */
  groupsScheduled?: boolean;
  /** The league started (status, a phase left `upcoming`, or a round exists). */
  leagueStarted?: boolean;
  formatAttached?: boolean;
  formatHasVersions?: boolean;
  /** A pinned ruleset target is completed. */
  pinLocked?: boolean;
  /** The pool is in progress (the server has no status guard, so the assistant checks). */
  poolInProgress?: boolean;
  /** The ruleset definition has (or had) a published version, read live: it can no longer be deleted by an undo. */
  rulesetPublished?: boolean;
}

export interface UndoLiveState {
  /**
   * The live fingerprint of each entry's entity by `actionId`, computed like the stored one. `null`: the entity is gone.
   * Absent: it was not read, which fails closed.
   */
  fingerprints: Readonly<Record<string, string | null>>;
  locks?: UndoLockFacts;
}

export type UndoReason =
  | 'unknown_op'
  | 'immutable'
  | 'outward_effect'
  | 'separate_card'
  | 'not_offered'
  | 'needs_superadmin'
  | 'residue'
  | 'already_undone'
  | 'not_completed'
  | 'edited_outside'
  | 'entity_gone'
  | 'fingerprint_unavailable'
  | 'locked_started'
  | 'locked_rounds'
  | 'locked_groups'
  | 'locked_in_progress'
  | 'format_in_use'
  | 'pin_locked'
  | 'ruleset_published'
  /** A ruleset restore that a delete of the same draft replaces. */
  | 'superseded'
  | 'too_many_steps'
  | 'snapshot_unavailable'
  /** The ledger row lacks what the reversal is built from (an old row, or a recipe that was not recorded). */
  | 'before_missing';

export type UndoAction =
  | 'restore_plan_revision'
  | 'format_delete'
  | 'format_draft_restore'
  | 'format_make_private'
  | 'ruleset_draft_restore'
  | 'delete_ruleset_draft'
  | 'archive_league'
  | 'archive_tournament'
  | 'remove_roster'
  | 'clear_groups'
  | 'inverse_patch'
  | 'reattach_previous_format'
  | 'pin_back'
  | 'delete_added_entries';

type Lock = keyof UndoLockFacts;

type Rule =
  | {
      kind: 'reversal';
      action: UndoAction;
      /** `D` reversals are our own tables or private drafts; `G` ones have outward reach and keep their own card. */
      tier: 'D' | 'B' | 'G';
      /** The entity may be gone or changed without blocking (a plan revision has no live entity). */
      noEntity?: boolean;
      /** Locks that must be false. */
      unless?: Partial<Record<Lock, UndoReason>>;
    }
  | { kind: 'none'; reason: UndoReason };

/** The 4.7 table, one row per ledger op. An op that is not here is `unknown_op`. */
const RULES: Readonly<Record<string, Rule>> = Object.freeze({
  plan_set: { kind: 'reversal', action: 'restore_plan_revision', tier: 'D', noEntity: true },
  plan_patch: { kind: 'reversal', action: 'restore_plan_revision', tier: 'D', noEntity: true },
  format_create: { kind: 'reversal', action: 'format_delete', tier: 'B', unless: { formatAttached: 'format_in_use', formatHasVersions: 'format_in_use' } },
  format_fork_preset: { kind: 'reversal', action: 'format_delete', tier: 'B', unless: { formatAttached: 'format_in_use', formatHasVersions: 'format_in_use' } },
  format_fork: { kind: 'reversal', action: 'format_delete', tier: 'B', unless: { formatAttached: 'format_in_use', formatHasVersions: 'format_in_use' } },
  format_save_draft: { kind: 'reversal', action: 'format_draft_restore', tier: 'D' },
  format_publish: { kind: 'none', reason: 'immutable' },
  format_set_visibility: { kind: 'reversal', action: 'format_make_private', tier: 'G' },
  // Attach has its own G card (it deletes the phases it created); the undo list points there.
  format_attach: { kind: 'none', reason: 'separate_card' },
  format_reattach: { kind: 'reversal', action: 'reattach_previous_format', tier: 'G', unless: { leagueStarted: 'locked_started' } },
  format_detach: { kind: 'reversal', action: 'reattach_previous_format', tier: 'G', unless: { leagueStarted: 'locked_started' } },
  // The second carve-out (spec §18.8): a ruleset created in this conversation is deleted while it has never
  // been published. Any version makes it residue (a version may already be pinned).
  ruleset_create_draft: { kind: 'reversal', action: 'delete_ruleset_draft', tier: 'G', unless: { rulesetPublished: 'ruleset_published' } },
  ruleset_patch_draft: { kind: 'reversal', action: 'ruleset_draft_restore', tier: 'D' },
  ruleset_publish: { kind: 'none', reason: 'immutable' },
  ruleset_move_pin: { kind: 'reversal', action: 'pin_back', tier: 'G', unless: { pinLocked: 'pin_locked' } },
  league_create: { kind: 'reversal', action: 'archive_league', tier: 'B' },
  league_update: { kind: 'reversal', action: 'inverse_patch', tier: 'B' },
  league_status: { kind: 'reversal', action: 'inverse_patch', tier: 'G' },
  roster_add: {
    kind: 'reversal',
    action: 'remove_roster',
    tier: 'B',
    unless: { groupsScheduled: 'locked_groups', roundsExist: 'locked_rounds' },
  },
  // Phases are archived with the league; delete is not a tool.
  phase_create: { kind: 'none', reason: 'residue' },
  groups_set: { kind: 'reversal', action: 'clear_groups', tier: 'B', unless: { roundsExist: 'locked_rounds' } },
  draft_pool_create: { kind: 'none', reason: 'residue' },
  draft_entries_add: { kind: 'reversal', action: 'delete_added_entries', tier: 'B', unless: { poolInProgress: 'locked_in_progress' } },
  tournament_create: { kind: 'reversal', action: 'archive_tournament', tier: 'B' },
  // Posts cannot be recalled; resets exist but roll back results and do not recall posts.
  start_phase: { kind: 'none', reason: 'outward_effect' },
  generate_round: { kind: 'none', reason: 'outward_effect' },
  generate_bracket: { kind: 'none', reason: 'outward_effect' },
  advance_phase: { kind: 'none', reason: 'outward_effect' },
  complete_round: { kind: 'none', reason: 'outward_effect' },
  complete_tournament: { kind: 'none', reason: 'outward_effect' },
  draft_start: { kind: 'none', reason: 'outward_effect' },
  // The recycle bin is restored by a superadmin only; never by the assistant.
  league_trash: { kind: 'none', reason: 'needs_superadmin' },
});

/** The ops this module knows a rule for (a test pins this list against the registry's ledger ops). */
export const UNDO_OPS: readonly string[] = Object.freeze(Object.keys(RULES));

/** Whether the 4.7 table has a reversal for this op (before any live check: a lock or an outside edit can still say no later). */
export function hasReversal(op: string): boolean {
  return RULES[op]?.kind === 'reversal';
}

/** At most this many steps in one undo proposal. */
export const UNDO_MAX_STEPS = 20;

/** Every reason a catalog must word (the card shows them). */
export const UNDO_REASONS: readonly UndoReason[] = Object.freeze([
  'unknown_op', 'immutable', 'outward_effect', 'separate_card', 'not_offered', 'needs_superadmin', 'residue', 'already_undone', 'not_completed',
  'edited_outside', 'entity_gone', 'fingerprint_unavailable', 'locked_started', 'locked_rounds', 'locked_groups', 'locked_in_progress',
  'format_in_use', 'pin_locked', 'ruleset_published', 'superseded', 'too_many_steps', 'snapshot_unavailable', 'before_missing',
]);

export type Undoability =
  | { available: true; action: UndoAction; tier: 'D' | 'B' | 'G' }
  | { available: false; reason: UndoReason };

/** Whether one ledger entry can be reversed right now, and if not, why. */
export function undoability(entry: LedgerEntryView, live: UndoLiveState): Undoability {
  if (entry.status === 'undone') return { available: false, reason: 'already_undone' };
  if (entry.status !== 'ok') return { available: false, reason: 'not_completed' };
  const rule = RULES[entry.op];
  if (rule === undefined) return { available: false, reason: 'unknown_op' };
  if (rule.kind === 'none') return { available: false, reason: rule.reason };
  // A gallery visibility change cannot be undone by its owner.
  if (entry.op === 'format_set_visibility' && entry.variant === 'gallery') return { available: false, reason: 'not_offered' };

  if (!rule.noEntity && entry.afterFingerprint !== null) {
    if (!(entry.actionId in live.fingerprints)) return { available: false, reason: 'fingerprint_unavailable' };
    const current = live.fingerprints[entry.actionId];
    if (current === null) return { available: false, reason: 'entity_gone' };
    if (current !== entry.afterFingerprint) return { available: false, reason: 'edited_outside' };
  }

  for (const [lock, reason] of Object.entries(rule.unless ?? {}) as Array<[Lock, UndoReason]>) {
    if (live.locks?.[lock] === true) return { available: false, reason };
  }
  // The inverse of a settings change cannot restore a pin or a league type once the league started.
  if (entry.op === 'league_update' && live.locks?.leagueStarted === true) {
    const blocked = (entry.changedFields ?? []).some((field) => field === 'ruleset_id' || field === 'format_type');
    if (blocked) return { available: false, reason: 'locked_started' };
  }
  return { available: true, action: rule.action, tier: rule.tier };
}

export interface UndoStep {
  /** `undo.<actionId>`: unique inside the proposal. */
  key: string;
  actionId: string;
  op: string;
  action: UndoAction;
  tier: 'D' | 'B' | 'G';
  entityType: string | null;
  entityId: string | null;
  /** The precondition checked again at execution: the entity must still look as the assistant left it. */
  afterFingerprint: string | null;
}

export interface UndoEntryNote {
  actionId: string;
  op: string;
  entityType: string | null;
  entityId: string | null;
  reason: UndoReason;
}

export interface UndoPlan {
  /** Newest first. */
  steps: UndoStep[];
  leftAlone: UndoEntryNote[];
  residue: UndoEntryNote[];
  notUndoable: UndoEntryNote[];
  /** More reversals were available than fit in one proposal; undo the rest in a second one. */
  truncated: boolean;
}

export function deriveUndoPlan(entries: readonly LedgerEntryView[], live: UndoLiveState, maxSteps: number = UNDO_MAX_STEPS): UndoPlan {
  const plan: UndoPlan = { steps: [], leftAlone: [], residue: [], notUndoable: [], truncated: false };
  const note = (entry: LedgerEntryView, reason: UndoReason): UndoEntryNote => ({
    actionId: entry.actionId,
    op: entry.op,
    entityType: entry.entityType,
    entityId: entry.entityId,
    reason,
  });
  for (const entry of [...entries].sort((a, b) => b.seq - a.seq)) {
    // Only what this conversation wrote and finished: failed, skipped and unknown rows have nothing to reverse here.
    if (entry.status === 'undone' || entry.status === 'failed' || entry.status === 'skipped' || entry.status === 'executing') continue;
    const result = undoability(entry, live);
    if (result.available) {
      if (plan.steps.length >= maxSteps) {
        plan.truncated = true;
        continue;
      }
      plan.steps.push({
        key: `undo.${entry.actionId}`,
        actionId: entry.actionId,
        op: entry.op,
        action: result.action,
        tier: result.tier,
        entityType: entry.entityType,
        entityId: entry.entityId,
        afterFingerprint: entry.afterFingerprint,
      });
    } else if (result.reason === 'edited_outside') plan.leftAlone.push(note(entry, result.reason));
    else if (result.reason === 'residue' || result.reason === 'ruleset_published') plan.residue.push(note(entry, result.reason));
    else plan.notUndoable.push(note(entry, result.reason));
  }
  return plan;
}
