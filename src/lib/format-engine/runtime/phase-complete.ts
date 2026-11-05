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
import { getTournamentById, updateTournament } from '@/lib/supabase/queries/tournaments';
import { runAutoAdvance } from '../auto-advance';
import { isKitCandidate, onPhaseStatusChanged } from './hooks';

const TAG = 'format-engine/stage-end';

/** `completed` when this call moved the phase, `skipped` when it was not active (already completed, or not started). */
export async function completePhaseAtStageEnd(tournamentId: string, reason: string): Promise<'completed' | 'skipped'> {
  const before = await getTournamentById(tournamentId);
  if (before === null || before.status !== 'active' || !isKitCandidate(before)) return 'skipped';

  const tournament = await updateTournament(tournamentId, { status: 'completed' });

  let autoAdvanceError: string | null = null;
  let advanced = 0;
  try {
    const results = await runAutoAdvance(before.season_id, tournamentId);
    advanced = results.length;
    for (const entry of results) expireTournamentReads(entry.target_phase_id, before.season_id);
  } catch (error) {
    logger.error(TAG, 'auto advance failed after the stage ended', { tournamentId, error });
    autoAdvanceError = 'auto_advance_failed';
  }

  await onPhaseStatusChanged({ tournament: before, from: before.status, to: 'completed' });
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
  return 'completed';
}
