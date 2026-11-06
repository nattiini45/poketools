/**
 * A phase of a kit league whose stage reached its `end_when`: the same sequence as `PATCH /api/tournaments/[id]` with
 * `status: 'completed'` (the status write, the `auto` edges out of the phase, the format's stage-end reaction, the cache
 * expiry, the audit event and the announcements), run by the system instead of an admin. Server only.
 */
import 'server-only';

import { logAuditEvent } from '@/lib/audit/log';
import { emitDiscordEvent } from '@/lib/discord/notify';
import { logger } from '@/lib/logger';
import { expireTournamentReads } from '@/lib/revalidation';
import { emitSocialEvent } from '@/lib/social/notify';
import { completeTournamentIfActive, getTournamentById } from '@/lib/supabase/queries/tournaments';
import { AutoAdvanceError, runAutoAdvance, type AutoAdvanceResult } from '../auto-advance';
import { isKitCandidate, onPhaseStatusChanged } from './hooks';

const TAG = 'format-engine/stage-end';

/**
 * `completed` when this call moved the phase, `skipped` when it did not (not active, or another call moved it), and
 * `reaction_failed` when the phase is completed but the format's reaction to it (the `stage_end` event, the tie and
 * expression checks) did not apply: the caller reports a failed step so that its retry (the match finalize heal) calls
 * this again. A call that finds the phase already completed repeats only that reaction, which is idempotent by event and
 * check keys; the status write, the auto edges, the audit entry and the announcements are not repeated.
 */
export async function completePhaseAtStageEnd(
  tournamentId: string,
  reason: string,
): Promise<'completed' | 'skipped' | 'reaction_failed'> {
  const before = await getTournamentById(tournamentId);
  if (before === null || !isKitCandidate(before)) return 'skipped';
  if (before.status === 'completed') {
    // A reaction that failed after the flip left nothing else to run it: every later call lands here.
    const reacted = await onPhaseStatusChanged({ tournament: before, from: 'active', to: 'completed' });
    return reacted ? 'skipped' : 'reaction_failed';
  }
  if (before.status !== 'active') return 'skipped';

  // Compare-and-set: of two last matches finishing together, only the call that moved the row runs the rest.
  const tournament = await completeTournamentIfActive(tournamentId);
  if (tournament === null) return 'skipped';

  let autoAdvanceError: string | null = null;
  let results: AutoAdvanceResult[] = [];
  try {
    results = await runAutoAdvance(before.season_id, tournamentId);
  } catch (error) {
    logger.error(TAG, 'auto advance failed after the stage ended', { tournamentId, error });
    autoAdvanceError = 'auto_advance_failed';
    // The targets that did advance still show on their pages and in the audit entry.
    if (error instanceof AutoAdvanceError) results = error.results;
  }
  const advanced = results.length;
  for (const entry of results) expireTournamentReads(entry.target_phase_id, before.season_id);

  const reacted = await onPhaseStatusChanged({ tournament: before, from: before.status, to: 'completed' });
  expireTournamentReads(tournamentId, before.season_id);

  logAuditEvent({
    action: 'tournament.update',
    actor_id: null,
    actor_name: 'System',
    resource_type: 'tournament',
    resource_id: tournamentId,
    resource_name: tournament.name,
    changes: { status: { before: before.status, after: 'completed' } },
    metadata: { via: 'stage_end', reason, auto_advanced: advanced, auto_advance_error: autoAdvanceError },
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
