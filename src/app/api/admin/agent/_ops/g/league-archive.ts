import { defineBinding, type VerifyCall, type VerifyResult } from '@/lib/ai/admin-agent/dispatch';
import { idParams, leagueArchiveBody } from './schemas';
import { readLeague } from './shared';

/**
 * `league_archive`: `PATCH /api/seasons/[id]` with `{ archived: true }`, the compensating call of `league_create` (nothing is
 * hard-deleted). The route archives every phase with the league. Declared now for the reversal; staging cannot reach it yet.
 */
export const leagueArchive = defineBinding<VerifyCall>({
  operation: 'league_archive',
  method: 'PATCH',
  path: '/api/seasons/[id]',
  class: 'B',
  phase: 1,
  load: () => import('@/app/api/seasons/[id]/route'),
  paramsSchema: idParams,
  bodySchema: leagueArchiveBody,
  reversal: { kind: 'none' },
  async verify(call): Promise<VerifyResult> {
    const league = await readLeague(call.params.id);
    if (league === null) return { status: 'absent' };
    return league.archived ? { status: 'confirmed', detail: { id: league.id } } : { status: 'absent' };
  },
});
