import { defineBinding, type VerifyCall, type VerifyResult } from '@/lib/ai/admin-agent/dispatch';
import { publishedVersionId, readRulesetVersions } from './golive-reads';
import { idParams, publishRulesetBody } from './schemas';
import { createdSince } from './shared';

/**
 * `publish_ruleset`: `POST /api/ruleset-definitions/[id]/publish`. Publishes the draft as the next immutable version. One
 * database function does it atomically, so the outcome is a version or nothing; what can be lost is the answer. The route
 * writes the audit event `ruleset.publish` (version number and hashes) itself.
 *
 * Read-back: by the version id the route answered with (`data.version.id`), else by what a publish leaves behind: exactly one
 * version created since the approval, by the approving admin, and it is the head (the highest version number). No such
 * version is `absent`; two are `unknown` and ambiguous (nothing is adopted). `confirmed` carries `{ id, version_no }`.
 */
export const publishRuleset = defineBinding<VerifyCall>({
  operation: 'publish_ruleset',
  method: 'POST',
  path: '/api/ruleset-definitions/[id]/publish',
  class: 'G',
  phase: 1,
  load: () => import('@/app/api/ruleset-definitions/[id]/publish/route'),
  paramsSchema: idParams,
  bodySchema: publishRulesetBody,
  // The same groups the tool declares (`registry/outward-effects.ts`); a publish posts nothing to Discord or social.
  outwardEffects: [
    { group: 'immutable_version', events: [] },
    { group: 'shared_selectable', events: [] },
  ],
  // A published version is immutable: it is never edited or removed, a later version supersedes it.
  reversal: { kind: 'none' },
  async verify(call, outcome, ctx): Promise<VerifyResult> {
    const versions = await readRulesetVersions(call.params.id);
    const knownId = publishedVersionId(outcome);
    if (knownId !== null) {
      const version = versions.find((candidate) => candidate.id.toLowerCase() === knownId);
      return version ? { status: 'confirmed', detail: { id: version.id, version_no: version.version_no } } : { status: 'absent' };
    }

    if (ctx.approvedAt === undefined) return { status: 'unknown' };
    const approvedAt = ctx.approvedAt;
    // The approving admin's own publish: a version somebody else published in the same minute is not this step's.
    const recent = versions.filter((version) => createdSince(version.created_at, approvedAt) && (version.created_by === null || version.created_by.toLowerCase() === ctx.adminId.toLowerCase()));
    if (recent.length === 0) return { status: 'absent' };
    if (recent.length > 1) return { status: 'unknown', detail: { ambiguous: true, matches: recent.length } };
    const [version] = recent;
    const head = versions[0];
    if (head === undefined || head.id !== version.id) return { status: 'unknown', detail: { id: version.id, version_no: version.version_no, head_version_no: head?.version_no ?? null } };
    return { status: 'confirmed', detail: { id: version.id, version_no: version.version_no } };
  },
});
