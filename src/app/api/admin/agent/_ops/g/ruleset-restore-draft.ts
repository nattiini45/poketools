import { defineBinding, type VerifyCall, type VerifyResult } from '@/lib/ai/admin-agent/dispatch';
import { hashJson } from '@/lib/ai/admin-agent/plans/hash';
import { readDraft } from './golive-reads';
import { idParams, restoreDraftBody } from './schemas';

/**
 * `ruleset_restore_draft`: `PUT /api/ruleset-definitions/[id]/draft` with the previous document (the snapshot the chat's draft
 * save kept) and a compare-and-set on the revision that save left. The undo of a ruleset draft save; class D (a private draft
 * changes no league), run inside an undo proposal like every other undo step. A human save since is a 409
 * `ruleset_stale_revision` and the step fails with that code (a "restore anyway" choice is not offered).
 *
 * Read-back: the draft now holds the document the call sent (`confirmed`, with the new revision), or it does not (`absent`).
 */
export const rulesetRestoreDraft = defineBinding<VerifyCall>({
  operation: 'ruleset_restore_draft',
  method: 'PUT',
  path: '/api/ruleset-definitions/[id]/draft',
  class: 'D',
  phase: 1,
  load: () => import('@/app/api/ruleset-definitions/[id]/draft/route'),
  paramsSchema: idParams,
  bodySchema: restoreDraftBody,
  reversal: { kind: 'none' },
  async verify(call): Promise<VerifyResult> {
    const body = restoreDraftBody.safeParse(call.body);
    if (!body.success) return { status: 'unknown' };
    const draft = await readDraft(call.params.id);
    if (draft === null) return { status: 'absent' };
    return hashJson(draft.document) === hashJson(body.data.document) ? { status: 'confirmed', detail: { id: call.params.id, draft_rev: draft.draft_rev } } : { status: 'absent' };
  },
});
