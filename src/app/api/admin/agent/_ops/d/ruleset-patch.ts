import { defineBinding } from '@/lib/ai/admin-agent/dispatch';
import { definitionParams, rulesetDraftBody } from './schemas';

/**
 * `ruleset_patch_draft`: `PUT /api/ruleset-definitions/[id]/draft`. The route takes the WHOLE document with a
 * compare-and-set on `draft_rev` (a stale revision is a 409 `ruleset_stale_revision` carrying the current one). The tool's
 * RFC 6901 operations are applied by the runner to the current draft first (`staged/draft-tools.ts`), so this binding
 * only carries the result: `{ draft_rev, document }`. The route owns the guard (viewer plus the edit rule), the limiter
 * (300 per 10 minutes, shared with the editor) and the document limits.
 */
export interface RulesetPatchArgs {
  ruleset_id: string;
  draft_rev: number;
  /** The patched document, built by the runner from the draft it just read. */
  document: Record<string, unknown>;
}

export const rulesetPatchDraft = defineBinding<RulesetPatchArgs>({
  operation: 'ruleset_patch_draft',
  method: 'PUT',
  path: '/api/ruleset-definitions/[id]/draft',
  class: 'D',
  phase: 1,
  load: () => import('@/app/api/ruleset-definitions/[id]/draft/route'),
  paramsSchema: definitionParams,
  bodySchema: rulesetDraftBody,
  buildParams: (args) => ({ id: args.ruleset_id }),
  buildBody: (args) => ({ draft_rev: args.draft_rev, document: args.document }),
});
