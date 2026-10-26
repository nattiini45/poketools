import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { safeErrorResponse } from '@/lib/api/error-response';
import { readBoundedJson } from '@/lib/ruleset-studio/api-body';
import { rulesetPinsSchema, validationFailedResponse } from '@/lib/ruleset-studio/api-schemas';
import { requireRulesetViewer } from '@/lib/ruleset-studio/guards';
import { movePins, type MovePinsOutcome } from '@/lib/ruleset-studio/pins';
import { logAuditEvent } from '@/lib/audit/log';
import { expireSeasonReads, expireTournamentReads } from '@/lib/revalidation';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import { getPinTargetStates } from '@/lib/supabase/queries/ruleset-definitions';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/ruleset-definitions/[id]/pins
 *
 * Moves leagues and phases that pin a version of this ruleset to another version of it. The caller must administer every
 * target (site admin, or a resource admin of the league or phase, live) and may see the ruleset. A target that has started needs
 * its id in `confirm_started` (409 `ruleset_pin_confirm_required` names the targets and writes nothing); a completed one is
 * refused (`ruleset_pin_locked`). The answer lists what moved with the difference between the two versions.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { player, definition } = await requireRulesetViewer(id);

    const rate = await checkRateLimit('ruleset-pin', player.playerId, { limit: 30, windowSeconds: 60 * 60 });
    if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);

    const parsed = rulesetPinsSchema.safeParse(await readBoundedJson(request));
    if (!parsed.success) return validationFailedResponse(parsed.error);

    const outcome = await movePins({
      actor: player,
      definition,
      toVersionNo: parsed.data.to_version_no,
      targets: parsed.data.targets,
      confirmStarted: parsed.data.confirm_started ?? [],
    });

    // The public reads of every moved league and phase show the ruleset: expire them.
    const states = await getPinTargetStates(
      outcome.moved.filter((m) => m.kind === 'season').map((m) => m.id),
      outcome.moved.filter((m) => m.kind === 'tournament').map((m) => m.id),
    );
    for (const state of states) {
      if (state.kind === 'season') expireSeasonReads(state.id);
      else expireTournamentReads(state.id, state.season_id);
    }
    revalidatePath('/admin/rulesets');

    for (const moved of outcome.moved) {
      logAuditEvent({
        action: 'ruleset.pin',
        actor_id: player.playerId,
        actor_name: player.name,
        resource_type: moved.kind === 'season' ? 'season' : 'tournament',
        resource_id: moved.id,
        resource_name: moved.name,
        changes: { ruleset_id: { before: moved.from_version_id, after: outcome.version_id } },
        metadata: { ruleset: definition.slug, version_no: outcome.version_no, started: moved.started },
      });
    }

    return NextResponse.json<ApiResult<MovePinsOutcome>>({ success: true, data: outcome });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to move the ruleset pin');
  }
}
