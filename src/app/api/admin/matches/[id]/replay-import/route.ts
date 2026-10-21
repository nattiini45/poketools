import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { recordGameResult } from '@/lib/pkmn/game-pipeline';
import { fetchBoundReplay } from '@/lib/pkmn/replay-binding';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import { emitMatchResultEffects } from '@/lib/match/result-effects';
import { replayImportSchema, formatZodErrors } from '@/lib/validation';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import { logAuditEvent } from '@/lib/audit/log';
import type { ApiResult } from '@/types/api';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/admin/matches/[id]/replay-import
 *
 * Admin/organizer-only. Records a game from a replay whose two sides the
 * organizer assigns to the registered match participants by hand — deliberately
 * skipping the username legibility gate so an organizer can import a replay
 * where a sub played under a different Showdown name. Audited.
 *
 * The organizer chooses only the side assignment. The route fetches the replay
 * again and records the winner and stats parsed from it, with its hash, through
 * the same bound-replay path as /api/parse-replay (audit lead F1, owner decision
 * 2026-10-20); corrections afterwards go through the admin game editor. The
 * body carries the preview's `replay_hash`: a replay that hashes differently now
 * is refused with 409 `replay_changed_since_preview` before anything is written.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const player = await requirePlayer();
    const { id: matchId } = await params;
    const invalidMatchId = rejectInvalidPathId(matchId, 'INVALID_MATCH_ID');
    if (invalidMatchId) return invalidMatchId;

    const rateResult = await checkRateLimit('replay-import', player.playerId, { limit: 20, windowSeconds: 60 * 60 });
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
    const zodResult = replayImportSchema.safeParse(rawBody);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }
    const body = zodResult.data;

    // Fetch the replay once more, hash it and parse it: the organizer reviewed
    // the preview of `body.replay_hash`, so a different battle is refused.
    const replay = await fetchBoundReplay(body.replay_url);
    if (replay.hash !== body.replay_hash) {
      console.error(
        `[replay-import] replay ${body.replay_url} for match ${matchId} hashes to ${replay.hash}, ` +
          `the preview had ${body.replay_hash}`
      );
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: 'The replay changed after it was previewed. Parse it again and review it before importing.',
          code: 'replay_changed_since_preview',
        },
        { status: 409 }
      );
    }

    // is_admin: true — the route already authorized the organizer for this match,
    // so the pipeline's participant check is intentionally bypassed. The
    // pipeline still requires the two sides to be the match's two participants
    // and reads the winner and stats from the bound replay.
    const result = await recordGameResult({
      match_id: matchId,
      source: 'ps_replay',
      replay,
      side_player_ids: body.side_player_ids,
      submitter_id: player.playerId,
      is_admin: true,
    });

    // Shared post-record side effects (revalidate, notify, AI, aggregates)
    await emitMatchResultEffects(matchId, {
      boReached: result.bo_reached,
      requestCookie: request.headers.get('cookie'),
      replayUrl: body.replay_url,
    });

    // Audit: this path skips the username legibility gate, so record who
    // imported it and how each side was assigned.
    logAuditEvent({
      actor_id: player.playerId,
      actor_name: player.name,
      action: 'game.import_replay',
      resource_type: 'game',
      resource_id: result.game_id,
      resource_name: `${match.player_1_name} vs ${match.player_2_name}`,
      metadata: {
        match_id: matchId,
        tournament_id: match.tournament_id,
        replay_url: body.replay_url,
        replay_hash: replay.hash,
        winner_id: result.game_winner_id,
        legibility_gate_bypassed: true,
        assignments: replay.parsed.players.map((side, index) => ({
          ps_username: side.ps_username,
          player_id: body.side_player_ids[index],
          pokemon_count: side.pokemon.length,
        })),
        match_status: result.match_status,
      },
      ip_address: request.headers.get('x-forwarded-for') ?? undefined,
    });

    return NextResponse.json<ApiResult<typeof result>>({ success: true, data: result });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to import replay');
  }
}
