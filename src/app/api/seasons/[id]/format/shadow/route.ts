import { NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { FormatStudioError } from '@/lib/format-studio/errors';
import { loadShadowDiff, type ShadowDiffReport } from '@/lib/format-engine/shadow';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** The diff reads every phase of the league twice (legacy and kit), so it is the dearest read of the format routes. */
const SHADOW_LIMIT = { limit: 60, windowSeconds: 60 * 60 } as const;

/**
 * GET /api/seasons/[id]/format/shadow
 *
 * League admin (or site admin). Where the kit's tables differ from the legacy ones, per phase and for the season
 * table: the shadow mode's diff, read before switching a league to the kit engine. Rows carry the player's id and
 * public name only. Rate limited per admin (429). 404 `season_not_found`, 404 `format_nothing_attached`.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const admin = await requireResourceAdmin('season', id);

    const rate = await checkRateLimit('format-shadow', admin.playerId, SHADOW_LIMIT);
    if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);

    const season = await getSeasonById(id);
    if (season === null) throw new UserFacingError('Season not found', { code: 'season_not_found', status: 404 });
    if (season.format_type !== 'custom') throw new FormatStudioError('format_nothing_attached');

    const report = await loadShadowDiff(id);
    if (report === null) throw new FormatStudioError('format_nothing_attached');
    return NextResponse.json<ApiResult<ShadowDiffReport>>({ success: true, data: report });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to compare the format engines');
  }
}
