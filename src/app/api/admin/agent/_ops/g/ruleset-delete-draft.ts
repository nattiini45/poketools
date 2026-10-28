import { defineBinding, type VerifyCall, type VerifyResult } from '@/lib/ai/admin-agent/dispatch';
import { readDefinition } from './golive-reads';
import { idParams } from './schemas';

/**
 * `ruleset_delete_draft`: `DELETE /api/ruleset-definitions/[id]`. The undo of a ruleset draft created in the chat, the second
 * carve-out to "undo never hard-deletes" (owner decision 2026-10-28): staging offers it only while the definition has never
 * been published, and the card's precondition checks that again at the step. The route itself refuses a definition that a league
 * or phase pins (409 `ruleset_in_use`), which maps to a failed step as usual. It takes no body.
 *
 * Read-back: the definition is gone (`confirmed`) or still there (`absent`).
 */
export const rulesetDeleteDraft = defineBinding<VerifyCall>({
  operation: 'ruleset_delete_draft',
  method: 'DELETE',
  path: '/api/ruleset-definitions/[id]',
  class: 'G',
  phase: 1,
  load: () => import('@/app/api/ruleset-definitions/[id]/route'),
  paramsSchema: idParams,
  bodySchema: null,
  // The undo card's group; nothing is posted anywhere.
  outwardEffects: [{ group: 'compensating_changes', events: [] }],
  reversal: { kind: 'none' },
  async verify(call): Promise<VerifyResult> {
    return (await readDefinition(call.params.id)) === null ? { status: 'confirmed', detail: { id: call.params.id } } : { status: 'absent' };
  },
});
