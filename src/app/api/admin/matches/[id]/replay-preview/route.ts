import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { fetchReplay, parseReplayLog } from '@/lib/pkmn/replay';
import { getPlayerByPsUsername } from '@/lib/supabase/queries/players';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import { replayPreviewSchema, formatZodErrors } from '@/lib/validation';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';
import type { ReplayPreviewResult, ReplaySideSuggestion } from '@/types/game';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/admin/matches/[id]/replay-preview
 *
 * Admin/organizer-only. Fetches + parses a Showdown replay and returns the
 * parsed stats WITHOUT the username legibility gate, plus best-effort
 * side→player suggestions for the manual-assign editor. Writes nothing.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const player = await requirePlayer();

    const rateResult = checkRateLimit(`replay-preview:${player.playerId}`, 20, 60 * 60 * 1000);
    if (!rateResult.allowed) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: `Rate limit exceeded. Try again in ${rateResult.retryAfterSeconds}s.`,
          code: 'rate_limited',
          params: { seconds: rateResult.retryAfterSeconds },
        },
        { status: 429, headers: { 'Retry-After': String(rateResult.retryAfterSeconds) } }
      );
    }

    const { id: matchId } = await params;
    const match = await getMatchById(matchId);
    if (!match) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Match not found', code: 'match_not_found' },
        { status: 404 }
      );
    }

    // Admin or tournament resource admin only — this bypasses the legibility gate.
    const authorized =
      player.isAdmin ||
      (await isResourceAdminFor(player.playerId, 'tournament', match.tournament_id));
    if (!authorized) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Admin access required', code: 'forbidden' },
        { status: 403 }
      );
    }

    const rawBody = await request.json();
    const zodResult = replayPreviewSchema.safeParse(rawBody);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }
    const body = zodResult.data;

    // Parse the replay — NO username gate.
    const replay = await fetchReplay(body.replay_url);
    const parsed = parseReplayLog(replay.log);

    // Best-effort suggestions: map a parsed side to a participant only when the
    // PS username resolves to one of the two registered players.
    const suggestions: ReplaySideSuggestion[] = [];
    for (const side of parsed.players) {
      const dbPlayer = await getPlayerByPsUsername(side.ps_username);
      const suggested =
        dbPlayer && (dbPlayer.id === match.player_1_id || dbPlayer.id === match.player_2_id)
          ? dbPlayer.id
          : null;
      suggestions.push({ ps_username: side.ps_username, suggested_player_id: suggested });
    }

    const data: ReplayPreviewResult = {
      parsed,
      winner_ps_username: parsed.winner_ps_username,
      suggestions,
    };

    return NextResponse.json<ApiResult<ReplayPreviewResult>>({ success: true, data });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to preview replay');
  }
}
