/**
 * The bulk processor behind `POST /api/admin/matches/batch`: runs one action
 * (confirm as reported, set the scheduled time, append an admin note) over a
 * list of already-scoped matches, one at a time, and reports one result per id.
 *
 * Authorization is the route's job and happens before this runs. Everything
 * here re-checks the match state on the fresh row and writes conditionally
 * (expected status, not completed, unchanged `updated_at`), so a match that
 * moved since the admin looked is reported as a conflict and never overwritten.
 *
 * The confirm path mirrors the single admin confirm in
 * `src/app/api/confirm-match/[mid]/route.ts` (same transition check, same
 * expected-status write, same finalize); a parity test guards the two against
 * drifting apart.
 */
import type { AuditLogEntry } from '@/lib/audit/log';
import {
  appendMatchNote,
  BULK_OK,
  bulkConfirmCheck,
  bulkScheduleCheck,
  formatBulkNoteLine,
  type AdminMatchBatchInput,
  type BulkItemResult,
} from '@/lib/admin/match-bulk';
import {
  getMatchById,
  setMatchScheduledAtIfOpen,
  updateMatchNotesIfUnchanged,
  updateMatchStatus,
} from '@/lib/supabase/queries/matches';
import { cancelPendingMatchProposalsForMatch } from '@/lib/supabase/queries/match-proposals';
import { finalizeMatchCompletion } from '@/lib/match/finalize';
import { revalidateMatchPages } from '@/lib/revalidation';
import { validateTransition } from '@/lib/tournament/match-state';
import type { MatchStatus, MatchWithPlayers } from '@/types/match';

/**
 * Time the items of one request may start in. Below the route's 300 s
 * `maxDuration`, so the response still goes out and the items that did not get
 * a turn are reported instead of the function being cut off.
 */
export const BULK_DEFAULT_BUDGET_MS = 240_000;

/** An audit entry without the actor, which the route adds. */
export type BulkAuditEntry = Omit<AuditLogEntry, 'actor_id' | 'actor_name'>;

export interface BulkItemOutcome {
  result: BulkItemResult;
  /** Present for an item that changed the match (including a finalize that only half succeeded). */
  audit?: BulkAuditEntry;
}

export interface BulkActionContext {
  actor: { playerId: string; name: string };
  batchId: string;
  /** Clock for the time budget and the note stamp (tests inject one). */
  nowMs?: () => number;
  budgetMs?: number;
}

function failed(id: string, code: Exclude<BulkItemResult['code'], 'ok'>, params?: BulkItemResult['params']): BulkItemOutcome {
  return { result: params ? { id, ok: false, code, params } : { id, ok: false, code } };
}

function matchLabel(match: MatchWithPlayers): string {
  return `${match.player_1_name} vs ${match.player_2_name}`;
}

/** What the admin previewed for one match of a bulk confirm (`params.expected` of the request). */
type BulkConfirmExpectation = { winner_id: string; status: MatchStatus };

async function confirmItem(
  match: MatchWithPlayers,
  expected: BulkConfirmExpectation | undefined,
  ctx: BulkActionContext
): Promise<BulkItemOutcome> {
  const eligibility = bulkConfirmCheck(match);
  if (!eligibility.eligible) return failed(match.id, eligibility.code);
  const winnerId = eligibility.winnerId;
  // The admin confirmed the result they saw in the preview. A match whose reported winner changed since then (a
  // corrected submission, an override) is not finalized for the new winner: it comes back as a conflict, unwritten.
  // The status is pending_confirmation here (checked above) and the write below is conditional on it.
  if (!expected || expected.winner_id !== winnerId || expected.status !== match.status) {
    return failed(match.id, 'match_bulk_conflict');
  }

  const transition = validateTransition(match.status, 'completed', {
    actor_id: ctx.actor.playerId,
    is_admin: true,
    winner_id: winnerId,
    player_1_id: match.player_1_id,
    player_2_id: match.player_2_id,
  });
  if (!transition.valid) {
    return failed(match.id, transition.code ?? 'match_bulk_item_failed', transition.params);
  }

  const previousStatus = match.status;
  // The same call as the single admin confirm: notes stay untouched (undefined), and the expected status makes a
  // match that moved meanwhile come back as null instead of being overwritten.
  const updated = await updateMatchStatus(match.id, 'completed', winnerId, ctx.actor.playerId, undefined, previousStatus);
  if (!updated) return failed(match.id, 'match_bulk_conflict');

  // The completion is committed from here on. Whatever goes wrong in the follow-up steps (finalize catches and
  // records its own step failures, but it can still throw or report that it did not run) must not turn the item
  // into a plain failure: the match is completed, so it is reported as such and audited.
  let failedSteps: number;
  let finalizeThrew = false;
  try {
    const finalize = await finalizeMatchCompletion({
      match: { ...match, winner_id: winnerId, status: 'completed' },
      winnerId,
      previousStatus,
    });
    if (!finalize.finalized) {
      // Unreachable after the checks above (the winner is a participant, the transition left a non-completed status).
      throw new Error(`Finalize did not run for match ${match.id}: ${finalize.reason ?? 'unknown'}`);
    }
    failedSteps = (finalize.failed_steps ?? []).length;
  } catch (err) {
    console.error(`[bulk-actions] finalize of the confirmed match ${match.id} failed after the completion was written`, err);
    // The steps that ran are unknown; the finalize run as a whole counts as one failed follow-up step.
    failedSteps = 1;
    finalizeThrew = true;
  }

  const audit: BulkAuditEntry = {
    action: 'match.bulk_confirm',
    resource_type: 'match',
    resource_id: match.id,
    resource_name: matchLabel(match),
    changes: {
      status: { before: previousStatus, after: 'completed' },
      winner_id: { before: match.winner_id, after: winnerId },
    },
    metadata: {
      batch_id: ctx.batchId,
      tournament_id: match.tournament_id,
      ...(failedSteps > 0 ? { finalize_failed_steps: failedSteps } : {}),
      ...(finalizeThrew ? { finalize_threw: true } : {}),
    },
  };
  // The completion is committed either way, so a half-finished finalize still counts as changed and is audited.
  if (failedSteps > 0) {
    return {
      result: { id: match.id, ok: true, code: 'match_finalize_incomplete', params: { count: failedSteps } },
      audit,
    };
  }
  return { result: { id: match.id, ok: true, code: BULK_OK }, audit };
}

async function scheduleItem(
  match: MatchWithPlayers,
  scheduledAt: string,
  ctx: BulkActionContext
): Promise<BulkItemOutcome> {
  const eligibility = bulkScheduleCheck(match);
  if (!eligibility.eligible) return failed(match.id, eligibility.code);

  const updated = await setMatchScheduledAtIfOpen(match.id, scheduledAt);
  if (!updated) {
    // No row matched: the match was completed meanwhile, or it is gone.
    const current = await getMatchById(match.id);
    return failed(match.id, current?.status === 'completed' ? 'match_bulk_schedule_completed' : 'match_bulk_conflict');
  }

  // The write is committed from here on; a failing follow-up is logged and never turns the item into a failure.
  try {
    // A pending proposal accepted later would overwrite the admin's time (the accept and repair routes cancel too).
    await cancelPendingMatchProposalsForMatch(match.id);
  } catch (err) {
    console.error(`[bulk-actions] could not cancel the pending proposals of match ${match.id}`, err);
  }
  try {
    await revalidateMatchPages(match.tournament_id, match.id);
  } catch (err) {
    console.error(`[bulk-actions] could not revalidate the pages of match ${match.id}`, err);
  }

  return {
    result: { id: match.id, ok: true, code: BULK_OK },
    audit: {
      action: 'match.bulk_schedule',
      resource_type: 'match',
      resource_id: match.id,
      resource_name: matchLabel(match),
      changes: { scheduled_at: { before: match.scheduled_at, after: scheduledAt } },
      metadata: { batch_id: ctx.batchId, tournament_id: match.tournament_id },
    },
  };
}

async function noteItem(
  match: MatchWithPlayers,
  note: string,
  ctx: BulkActionContext,
  now: Date
): Promise<BulkItemOutcome> {
  const line = formatBulkNoteLine(now, ctx.actor.name, note);
  const appended = appendMatchNote(match.notes ?? '', line);
  if (!appended.ok) return failed(match.id, appended.code);

  // Compare-and-set on the row version the admin acted on; the notes text itself is too long for a URL filter.
  const updated = await updateMatchNotesIfUnchanged(match.id, match.updated_at, appended.notes);
  if (!updated) return failed(match.id, 'match_bulk_conflict');

  // Notes are private (public match reads strip them), so there is nothing to revalidate.
  return {
    result: { id: match.id, ok: true, code: BULK_OK },
    audit: {
      action: 'match.bulk_note',
      resource_type: 'match',
      resource_id: match.id,
      resource_name: matchLabel(match),
      // Only the appended line, never the whole notes text.
      metadata: { batch_id: ctx.batchId, tournament_id: match.tournament_id, note_line: line },
    },
  };
}

/**
 * Runs `input.action` over `input.match_ids` and returns one outcome per id, in
 * request order. Items run one after another (finalize writes ratings and
 * streaks, which must not interleave). An id missing from `matchesById` is
 * `match_not_found`; an item that throws is logged with the original error and
 * reported as `match_bulk_item_failed` without its message, and the loop goes on.
 * Once the time budget is used up the remaining items are reported as
 * `match_bulk_not_processed` without any write.
 */
export async function runBulkAction(
  input: AdminMatchBatchInput,
  matchesById: Map<string, MatchWithPlayers>,
  ctx: BulkActionContext
): Promise<BulkItemOutcome[]> {
  const clock = ctx.nowMs ?? Date.now;
  const budgetMs = ctx.budgetMs ?? BULK_DEFAULT_BUDGET_MS;
  const startedAt = clock();
  const outcomes: BulkItemOutcome[] = [];
  const expectedByMatch = new Map<string, BulkConfirmExpectation>(
    input.action === 'confirm' ? input.params.expected.map((entry) => [entry.match_id, entry]) : []
  );

  for (const id of input.match_ids) {
    if (clock() - startedAt >= budgetMs) {
      outcomes.push(failed(id, 'match_bulk_not_processed'));
      continue;
    }
    const match = matchesById.get(id);
    if (!match) {
      outcomes.push(failed(id, 'match_not_found'));
      continue;
    }
    try {
      if (input.action === 'confirm') {
        outcomes.push(await confirmItem(match, expectedByMatch.get(id), ctx));
      } else if (input.action === 'schedule') {
        outcomes.push(await scheduleItem(match, input.params.scheduled_at, ctx));
      } else {
        outcomes.push(await noteItem(match, input.params.note, ctx, new Date(clock())));
      }
    } catch (err) {
      console.error(`[bulk-actions] ${input.action} failed for match ${id}`, err);
      outcomes.push(failed(id, 'match_bulk_item_failed'));
    }
  }

  return outcomes;
}
