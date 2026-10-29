import { defineBinding, type VerifyCall, type VerifyResult } from '@/lib/ai/admin-agent/dispatch';
import { idParams, tournamentArchiveBody } from './schemas';
import { readTournament } from './shared';

/**
 * `tournament_archive`: `PATCH /api/tournaments/[id]` with `{ archived: true }`, the compensating call of `tournament_create`
 * (nothing is hard-deleted). Declared now for the reversal; staging cannot reach it yet.
 */
export const tournamentArchive = defineBinding<VerifyCall>({
  operation: 'tournament_archive',
  method: 'PATCH',
  path: '/api/tournaments/[id]',
  class: 'B',
  phase: 1,
  load: () => import('@/app/api/tournaments/[id]/route'),
  paramsSchema: idParams,
  bodySchema: tournamentArchiveBody,
  reversal: { kind: 'none' },
  async verify(call): Promise<VerifyResult> {
    const tournament = await readTournament(call.params.id);
    if (tournament === null) return { status: 'absent' };
    return tournament.archived ? { status: 'confirmed', detail: { id: tournament.id } } : { status: 'absent' };
  },
});
