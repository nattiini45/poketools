import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { requireSeasonMember } from '@/lib/auth/season-member';
import { noStore } from '@/lib/format-engine/runtime/http';
import { loadPlayerView } from '@/lib/format-engine/runtime/views-server';
import type { PlayerFormatView } from '@/lib/format-engine/runtime/view-types';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';
import { READ_LEAGUE_LIMIT, READ_LIMIT } from '../_lib/limits';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/seasons/[id]/format/me
 *
 * A participant of the league (site admins get no bypass: this is the viewer's own view). The whole live view of the
 * viewer: actions with their windows and their own submission, the items and relations they may see (hidden relation
 * sides go through `visibleLinks`), the challenge ladders with their own challenges. `{ running: false }` when the
 * league does not run a kit format. Readable in a completed or archived league. Never cached: the answer is per viewer.
 * 403 `format_not_participant`, 429 `rate_limited`.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { player, seasonId } = await requireSeasonMember(id);

    const rate = await checkRateLimit(READ_LIMIT.bucket, player.playerId, READ_LIMIT);
    if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);
    const leagueRate = await checkRateLimit(READ_LEAGUE_LIMIT.bucket, seasonId, READ_LEAGUE_LIMIT);
    if (!leagueRate.allowed) return rateLimitedResponse(leagueRate.retryAfterSeconds);

    const view = await loadPlayerView(seasonId, player.playerId);
    return NextResponse.json<ApiResult<PlayerFormatView>>({ success: true, data: view }, noStore());
  } catch (err) {
    return safeErrorResponse(err, 'Failed to load the live format');
  }
}
