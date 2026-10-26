import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { readBoundedJson } from '@/lib/ruleset-studio/api-body';
import { rulesetPinImpactSchema, validationFailedResponse } from '@/lib/ruleset-studio/api-schemas';
import { requireRulesetViewer } from '@/lib/ruleset-studio/guards';
import type { PinImpact } from '@/lib/ruleset-studio/pin-info';
import { computePinImpact } from '@/lib/ruleset-studio/pin-impact.server';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/ruleset-definitions/[id]/pins/impact
 *
 * The question the confirmation of a pin move asks first: how many of the already-submitted teams of these leagues and phases
 * would stop being valid under version `to_version_no`? Same body as `POST .../pins` without `confirm_started`, same access
 * (the caller must administer every target and may see the ruleset), same refusals (unknown target, a pin of another
 * ruleset, a finished target); nothing is written. At most 2000 teams are validated per request (`truncated` says the bound
 * was reached) and the route has its own rate limit, because every call reads teams and runs the validator twice per team.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { player, definition } = await requireRulesetViewer(id);

    const rate = await checkRateLimit('ruleset-pin-impact', player.playerId, { limit: 60, windowSeconds: 60 * 60 });
    if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);

    const parsed = rulesetPinImpactSchema.safeParse(await readBoundedJson(request));
    if (!parsed.success) return validationFailedResponse(parsed.error);

    const impact = await computePinImpact({
      actor: player,
      definition,
      toVersionNo: parsed.data.to_version_no,
      targets: parsed.data.targets,
    });
    return NextResponse.json<ApiResult<PinImpact>>({ success: true, data: impact });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to check the ruleset pin move');
  }
}
