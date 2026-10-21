import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { fetchBoundReplay } from '@/lib/pkmn/replay-binding';
import { recordGameResult } from '@/lib/pkmn/game-pipeline';
import { getPlayerByPsUsername } from '@/lib/supabase/queries/players';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { emitMatchResultEffects } from '@/lib/match/result-effects';
import { parseReplaySchema, formatZodErrors } from '@/lib/validation';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';

export async function POST(request: NextRequest) {
  try {
    const player = await requirePlayer();

    const rateResult = await checkRateLimit('parse-replay', player.playerId, { limit: 20, windowSeconds: 60 * 60 });
    if (!rateResult.allowed) return rateLimitedResponse(rateResult.retryAfterSeconds);

    const rawBody = await request.json();
    const zodResult = parseReplaySchema.safeParse(rawBody);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }
    const body = zodResult.data;

    // 1. Fetch the replay once, hash it and parse it: the recorded winner and
    //    stats come from this bound replay and its hash goes on the game row
    //    (audit lead F1, owner decision 2026-10-20).
    const replay = await fetchBoundReplay(body.replay_url);
    const parsed = replay.parsed;

    // 2. Match PS usernames → Player IDs
    const match = await getMatchById(body.match_id);
    if (!match) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Match not found', code: 'match_not_found' },
        { status: 404 }
      );
    }

    // Try to resolve both PS usernames to our players
    const playerMap = new Map<string, string>(); // ps_username → player_id

    for (const parsedPlayer of parsed.players) {
      const dbPlayer = await getPlayerByPsUsername(parsedPlayer.ps_username);
      if (!dbPlayer) {
        // Legibility check failed. Clients (admins) can fall back to the
        // manual-assign import flow — surface a stable code so they can detect
        // this specific failure without string matching.
        return NextResponse.json<ApiResult<never>>(
          {
            success: false,
            code: 'name_mismatch',
            params: { username: parsedPlayer.ps_username },
            error: `Could not match PS username "${parsedPlayer.ps_username}" to a registered player. ` +
              `Players must set their PS username in their profile.`,
            ps_usernames: parsed.players.map((p) => p.ps_username),
          },
          { status: 400 }
        );
      }

      // Verify this player is actually in the match.
      // Dedicated `replay_player_not_in_match` code (params: username = PS name,
      // player = registered display name). ReplaySubmitForm treats it like
      // `name_mismatch` and still offers the admin manual-assign fallback, so
      // `ps_usernames` stays on the payload.
      if (dbPlayer.id !== match.player_1_id && dbPlayer.id !== match.player_2_id) {
        return NextResponse.json<ApiResult<never>>(
          {
            success: false,
            code: 'replay_player_not_in_match',
            params: { username: parsedPlayer.ps_username, player: dbPlayer.name },
            error: `Player "${parsedPlayer.ps_username}" (${dbPlayer.name}) is not a participant in this match`,
            ps_usernames: parsed.players.map((p) => p.ps_username),
          },
          { status: 400 }
        );
      }

      playerMap.set(parsedPlayer.ps_username, dbPlayer.id);
    }

    // 3. Run the shared game pipeline. Winner and stats are read from the
    //    bound replay there (400 `replay_winner_unknown` when the log names no
    //    side as the winner); a battle already recorded for any game is 409
    //    `replay_already_recorded`.
    const sidePlayerIds = parsed.players.map((p) => playerMap.get(p.ps_username) ?? '');
    const result = await recordGameResult({
      match_id: body.match_id,
      source: 'ps_replay',
      replay,
      side_player_ids: [sidePlayerIds[0] ?? '', sidePlayerIds[1] ?? ''],
      submitter_id: player.playerId,
      is_admin: player.isAdmin,
    });

    // 4. Shared post-record side effects (revalidate, notify, AI, aggregates)
    await emitMatchResultEffects(body.match_id, {
      boReached: result.bo_reached,
      requestCookie: request.headers.get('cookie'),
      replayUrl: body.replay_url,
    });

    return NextResponse.json<ApiResult<typeof result>>({
      success: true,
      data: result,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to parse replay');
  }
}
