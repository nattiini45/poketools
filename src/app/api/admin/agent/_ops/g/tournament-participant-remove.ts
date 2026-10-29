import { defineBinding, type VerifyCall, type VerifyResult } from '@/lib/ai/admin-agent/dispatch';
import { idParams, tournamentParticipantRemoveBody } from './schemas';
import { readTournamentRosterIds } from './shared';

/**
 * `tournament_participant_remove`: `DELETE /api/tournaments/[id]/participants`, one player, the compensating call of
 * `tournament_participant_add`. The route refuses it once the tournament has started. Only an undo proposal holds it.
 */
export const tournamentParticipantRemove = defineBinding<VerifyCall>({
  operation: 'tournament_participant_remove',
  method: 'DELETE',
  path: '/api/tournaments/[id]/participants',
  class: 'B',
  phase: 1,
  load: () => import('@/app/api/tournaments/[id]/participants/route'),
  paramsSchema: idParams,
  bodySchema: tournamentParticipantRemoveBody,
  reversal: { kind: 'none' },
  async verify(call): Promise<VerifyResult> {
    const body = tournamentParticipantRemoveBody.safeParse(call.body);
    if (!body.success) return { status: 'unknown' };
    const roster = await readTournamentRosterIds(call.params.id);
    return roster.has(body.data.player_id.toLowerCase()) ? { status: 'absent' } : { status: 'confirmed', detail: { removed: 1 } };
  },
});
