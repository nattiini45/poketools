import { defineBinding, type VerifyCall, type VerifyResult } from '@/lib/ai/admin-agent/dispatch';
import { tournamentParticipantRemoveCall } from '@/lib/ai/admin-agent/plans/undo-recipes';
import { idParams, tournamentParticipantAddBody } from './schemas';
import { readTournamentRosterIds } from './shared';

/**
 * `tournament_participant_add`: `POST /api/tournaments/[id]/participants`, ONE player of a standalone tournament. The route
 * answers 201 with no data once the row is in; it refuses (typed) a tournament that has started, a bracket whose seats are
 * fixed, and a player already enrolled (a masked error for the last: staging checks the roster before it stages).
 *
 * Read-back: the player is on the tournament's roster (`confirmed`) or is not (`absent`). Reversal: the remove route for the
 * same player, which the database refuses once the tournament has started.
 */
export const tournamentParticipantAdd = defineBinding<VerifyCall>({
  operation: 'tournament_participant_add',
  method: 'POST',
  path: '/api/tournaments/[id]/participants',
  class: 'B',
  phase: 1,
  load: () => import('@/app/api/tournaments/[id]/participants/route'),
  paramsSchema: idParams,
  bodySchema: tournamentParticipantAddBody,
  reversal: {
    kind: 'compensating',
    operation: 'tournament_participant_remove',
    buildInput: (call, _result) => {
      const body = tournamentParticipantAddBody.parse(call.body);
      return tournamentParticipantRemoveCall(call.params.id, body.player_id);
    },
  },
  async verify(call): Promise<VerifyResult> {
    const body = tournamentParticipantAddBody.safeParse(call.body);
    if (!body.success) return { status: 'unknown' };
    const roster = await readTournamentRosterIds(call.params.id);
    return roster.has(body.data.player_id.toLowerCase()) ? { status: 'confirmed', detail: { present: 1, expected: 1 } } : { status: 'absent', detail: { present: 0, expected: 1 } };
  },
});
