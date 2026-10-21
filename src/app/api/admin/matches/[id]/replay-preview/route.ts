import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { fetchBoundReplay } from '@/lib/pkmn/replay-binding';
import { findGameIdByReplayHash, ReplayAlreadyRecordedError } from '@/lib/supabase/queries/games';
import { getPlayerByPsUsername } from '@/lib/supabase/queries/players';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import { replayPreviewSchema, formatZodErrors } from '@/lib/validation';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';
import type { ReplayPreviewResult, ReplaySideSuggestion } from '@/types/game';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/admin/matches/[id]/replay-preview
 *
 * Admin/organizer-only. Fetches + parses a Showdown replay and returns the
 * parsed stats WITHOUT the username legibility gate, plus best-effort
 * side→player suggestions for the manual-assign editor and the replay's hash
 * (sent back by the import). A battle already recorded for any game is refused
 * here already (409 `replay_already_recorded`). Writes nothing.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const player = await requirePlayer();
    const { id: matchId } = await params;
    const invalidMatchId = rejectInvalidPathId(matchId, 'INVALID_MATCH_ID');
    if (invalidMatchId) return invalidMatchId;

    const rateResult = await checkRateLimit('replay-preview', player.playerId, { limit: 20, windowSeconds: 60 * 60 });
    if (!rateResult.allowed) return rateLimitedResponse(rateResult.retryAfterSeconds);

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
    const replay = await fetchBoundReplay(body.replay_url);
    const parsed = replay.parsed;

    // The import would refuse this battle; say so before the organizer reviews it.
    const existingGameId = await findGameIdByReplayHash(replay.hash);
    if (existingGameId) {
      console.error(`[replay-preview] replay hash ${replay.hash} is already bound to game ${existingGameId}`);
      throw new ReplayAlreadyRecordedError();
    }

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
      replay_hash: replay.hash,
    };

    return NextResponse.json<ApiResult<ReplayPreviewResult>>({ success: true, data });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to preview replay');
  }
}
