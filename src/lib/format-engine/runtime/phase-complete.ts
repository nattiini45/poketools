/**
 * A phase of a kit league whose stage reached its `end_when`: the same sequence as `PATCH /api/tournaments/[id]` with
 * `status: 'completed'` (the status write, the format's stage-end reaction, the `auto` edges out of the phase, the cache
 * expiry, the audit event and the announcements), run by the system instead of an admin. The reaction comes first because
 * a format can adjust stage points on `stage_end`, and the `auto` edges pick the players who move on from the standings
 * as they are after that. Server only.
 */
import 'server-only';

import { logAuditEvent } from '@/lib/audit/log';
import { emitDiscordEvent } from '@/lib/discord/notify';
import { logger } from '@/lib/logger';
import { expireTournamentReads } from '@/lib/revalidation';
import { emitSocialEvent } from '@/lib/social/notify';
import { completeTournamentIfActive, getTournamentById } from '@/lib/supabase/queries/tournaments';
import { isKitCandidate, onPhaseStatusChanged } from './hooks';
import { advanceAfterStageEnd, stageEndFired } from './stage-end-advance';

const TAG = 'format-engine/stage-end';

/**
 * `completed` when this call moved the phase, `skipped` when it did not (not active, another call moved it, or an unfinished
 * match exists that `knownUnfinished` does not list: a challenge accepted after the caller read the phase's matches, so the
 * stage has not ended after all; the phase stays active and the finalize of that match evaluates `end_when` again), and
 * `reaction_failed` when the phase is completed but the format's reaction to it (the `stage_end` event, the tie and
 * expression checks) did not apply: the caller reports a failed step so that its retry (the match finalize heal) calls
 * this again. The `auto` edges out of the phase wait for the reaction: while it has not applied, nobody is advanced (the
 * standings would lack what the reaction adjusts), and the audit entry says so (`auto_advance_held`).
 *
 * A call that finds the phase already completed repeats the reaction, which is idempotent by event and check keys; the
 * status write, the audit entry and the announcements are not repeated. When that repeated reaction applies, the held
 * advance runs, but only while no target holds a block of this phase's players yet (`StageEndAdvanceInput.retry`): the
 * auto advance rewrites a target's enrollment from the current standings, so it must never run a second time over an
 * advance that happened, nor over a correction an admin made since. A repeat that finds the advance done runs nothing.
 */
export async function completePhaseAtStageEnd(
  tournamentId: string,
  reason: string,
  knownUnfinished: readonly string[],
): Promise<'completed' | 'skipped' | 'reaction_failed'> {
  const before = await getTournamentById(tournamentId);
  if (before === null || !isKitCandidate(before)) return 'skipped';
  if (before.status === 'completed') {
    // A reaction that failed after the flip left nothing else to run it: every later call lands here.
    const reacted = await onPhaseStatusChanged({ tournament: before, from: 'active', to: 'completed' });
    if (!reacted && !(await stageEndFired(before.season_id, tournamentId))) return 'reaction_failed';
    // The advance the failed reaction held back (it does nothing when the advance already happened).
    const advance = await advanceAfterStageEnd({ seasonId: before.season_id, phaseId: tournamentId, retry: true });
    if (advance.ran) {
      logAuditEvent({
        action: 'tournament.update',
        actor_id: null,
        actor_name: 'System',
        resource_type: 'tournament',
        resource_id: tournamentId,
        resource_name: before.name,
        metadata: { via: 'stage_end_retry', reason, auto_advanced: advance.results.length, auto_advance_error: advance.error },
      });
    }
    return reacted ? 'skipped' : 'reaction_failed';
  }
  if (before.status !== 'active') return 'skipped';

  // Compare-and-set under a lock on the phase row: of two last matches finishing together, only the call that moved the row
  // runs the rest, and a match created since the caller's read (`knownUnfinished`) keeps the phase open.
  const claim = await completeTournamentIfActive(tournamentId, knownUnfinished);
  if (claim.outcome === 'unsettled') {
    logger.info(TAG, 'stage end deferred: an unfinished match appeared after the facts were read', {
      tournamentId,
      unknownUnfinished: claim.unknownUnfinished,
    });
    return 'skipped';
  }
  if (claim.outcome !== 'completed') return 'skipped';
  const tournament = claim.tournament;

  // The reaction first: it may adjust stage points, and the players who move on are picked from the standings after it. A
  // reaction that failed before its event fired holds the advance back (the caller retries it, and the retry runs the advance).
  const reacted = await onPhaseStatusChanged({ tournament: before, from: before.status, to: 'completed' });
  const mayAdvance = reacted || (await stageEndFired(before.season_id, tournamentId));
  const advance = mayAdvance
    ? await advanceAfterStageEnd({ seasonId: before.season_id, phaseId: tournamentId, retry: false })
    : { ran: false, results: [], error: null };
  expireTournamentReads(tournamentId, before.season_id);

  logAuditEvent({
    action: 'tournament.update',
    actor_id: null,
    actor_name: 'System',
    resource_type: 'tournament',
    resource_id: tournamentId,
    resource_name: tournament.name,
    changes: { status: { before: before.status, after: 'completed' } },
    metadata: {
      via: 'stage_end',
      reason,
      auto_advanced: advance.results.length,
      auto_advance_error: advance.error,
      auto_advance_held: !mayAdvance,
    },
  });

  const payload = {
    event_type: 'tournament_completed' as const,
    tournament_id: tournamentId,
    season_id: tournament.season_id,
    data: { kind: 'tournament_status' as const, tournament_name: tournament.name, new_status: 'completed' as const },
  };
  void emitDiscordEvent(payload);
  void emitSocialEvent(payload);
  return reacted ? 'completed' : 'reaction_failed';
}
