import { defineBinding, type VerifyCall, type VerifyResult } from '@/lib/ai/admin-agent/dispatch';
import { rosterRemoveCalls } from '@/lib/ai/admin-agent/plans/undo-recipes';
import { idParams, rosterAddBody } from './schemas';
import { readRosterIds } from './shared';

/**
 * `roster_add`: `POST /api/seasons/[id]/participants`, the bulk form. The route adds the players one by one and answers 201
 * when all are in, so a half-done add is an error or an unknown outcome, never a 2xx.
 *
 * Read-back: every player id of the body is on the league's roster (`confirmed`), none is (`absent`), or only some are
 * (`unknown`, with the counts; the step is never dispatched again).
 */
export const rosterAdd = defineBinding<VerifyCall>({
  operation: 'roster_add',
  method: 'POST',
  path: '/api/seasons/[id]/participants',
  class: 'B',
  phase: 1,
  load: () => import('@/app/api/seasons/[id]/participants/route'),
  paramsSchema: idParams,
  bodySchema: rosterAddBody,
  reversal: {
    kind: 'compensating',
    operation: 'roster_remove',
    // The remove route takes one player per call.
    buildInput: (call, _result) => {
      const body = rosterAddBody.parse(call.body);
      return rosterRemoveCalls(call.params.id, body.player_ids);
    },
  },
  async verify(call): Promise<VerifyResult> {
    const body = rosterAddBody.safeParse(call.body);
    if (!body.success) return { status: 'unknown' };
    const roster = await readRosterIds(call.params.id);
    const expected = new Set(body.data.player_ids.map((playerId) => playerId.toLowerCase()));
    const present = [...expected].filter((playerId) => roster.has(playerId)).length;
    const detail = { present, expected: expected.size };
    if (present === expected.size) return { status: 'confirmed', detail };
    return { status: present === 0 ? 'absent' : 'unknown', detail };
  },
});
