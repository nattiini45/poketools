import { defineBinding, type VerifyCall, type VerifyResult } from '@/lib/ai/admin-agent/dispatch';
import { readPinStates, readRulesetVersions } from './golive-reads';
import { idParams, movePinBody } from './schemas';

/**
 * `move_pin`: `POST /api/ruleset-definitions/[id]/pins`. Moves up to 50 leagues and phases to one version of the ruleset. The
 * route checks everything up front and then writes the moves one by one, each a compare-and-set: the first pin that moved
 * meanwhile stops the run with 409 `ruleset_pin_moved` and the earlier moves STAY (the route audits each one as `ruleset.pin`).
 * So a failed call can still have moved some targets, which is what the read-back counts.
 *
 * Read-back: how many targets now pin the version `to_version_no` of this ruleset. All of them: `confirmed` with
 * `{ id: version_id, version_no, moved, expected }`; none: `absent`; some: `unknown` with `{ moved, expected }` (the step is
 * never dispatched again). The executor also runs it after a 409 of this binding, so the ledger row of a `failed` step says how
 * far the call got. Undoing a move is a later `move_pin` proposal (to the previous version), not a reversal of this one.
 */
export const movePin = defineBinding<VerifyCall>({
  operation: 'move_pin',
  method: 'POST',
  path: '/api/ruleset-definitions/[id]/pins',
  class: 'G',
  phase: 1,
  load: () => import('@/app/api/ruleset-definitions/[id]/pins/route'),
  paramsSchema: idParams,
  bodySchema: movePinBody,
  outwardEffects: [{ group: 'live_rules_change', events: [] }],
  reversal: { kind: 'none' },
  async verify(call): Promise<VerifyResult> {
    const body = movePinBody.safeParse(call.body);
    if (!body.success) return { status: 'unknown' };
    const { to_version_no: versionNo, targets } = body.data;

    // Versions are immutable: the one this call moved to is found by number in the definition's own list.
    const version = (await readRulesetVersions(call.params.id)).find((candidate) => candidate.version_no === versionNo);
    if (version === undefined) return { status: 'unknown' };

    const pinned = new Set((await readPinStates(targets)).filter((state) => state.ruleset_id?.toLowerCase() === version.id.toLowerCase()).map((state) => `${state.kind}:${state.id.toLowerCase()}`));
    const moved = targets.filter((target) => pinned.has(`${target.kind}:${target.id.toLowerCase()}`)).length;
    const detail = { moved, expected: targets.length };
    if (moved === targets.length) return { status: 'confirmed', detail: { id: version.id, version_no: version.version_no, ...detail } };
    return { status: moved === 0 ? 'absent' : 'unknown', detail };
  },
});
