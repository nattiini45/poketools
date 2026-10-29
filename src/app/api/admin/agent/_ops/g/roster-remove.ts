import { defineBinding, type VerifyCall, type VerifyResult } from '@/lib/ai/admin-agent/dispatch';
import { idParams, rosterRemoveBody } from './schemas';
import { readRosterIds } from './shared';

/**
 * `roster_remove`: `DELETE /api/seasons/[id]/participants`, one player, the compensating call of `roster_add`. The database
 * refuses it once a grouped league has rounds. Declared now for the reversal; staging cannot reach it yet.
 */
export const rosterRemove = defineBinding<VerifyCall>({
  operation: 'roster_remove',
  method: 'DELETE',
  path: '/api/seasons/[id]/participants',
  class: 'B',
  phase: 1,
  load: () => import('@/app/api/seasons/[id]/participants/route'),
  paramsSchema: idParams,
  bodySchema: rosterRemoveBody,
  reversal: { kind: 'none' },
  async verify(call): Promise<VerifyResult> {
    const body = rosterRemoveBody.safeParse(call.body);
    if (!body.success) return { status: 'unknown' };
    const roster = await readRosterIds(call.params.id);
    return roster.has(body.data.player_id.toLowerCase()) ? { status: 'absent' } : { status: 'confirmed', detail: { removed: 1 } };
  },
});
