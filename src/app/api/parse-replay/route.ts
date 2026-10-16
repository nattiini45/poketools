import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { fetchReplay, parseReplayLog } from '@/lib/pkmn/replay';
import { recordGameResult } from '@/lib/pkmn/game-pipeline';
import { getPlayerByPsUsername } from '@/lib/supabase/queries/players';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { emitMatchResultEffects } from '@/lib/match/result-effects';
import { parseReplaySchema, formatZodErrors } from '@/lib/validation';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';
import type { BattleStatInsert } from '@/types/game';

export async function POST(request: NextRequest) {
  try {
    const player = await requirePlayer();

    const rateResult = checkRateLimit(`parse-replay:${player.playerId}`, 20, 60 * 60 * 1000);
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

    // 1. Fetch and parse replay
    const replay = await fetchReplay(body.replay_url);
    const parsed = parseReplayLog(replay.log);

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

    // 3. Determine winner player ID
    const winnerId = playerMap.get(parsed.winner_ps_username);
    if (!winnerId) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: `Could not determine winner from replay`, code: 'replay_winner_unknown' },
        { status: 400 }
      );
    }

    // 4. Build battle stat inserts
    const battleStats: BattleStatInsert[] = [];
    for (const parsedPlayer of parsed.players) {
      const playerId = playerMap.get(parsedPlayer.ps_username);
      if (!playerId) continue;

      for (const poke of parsedPlayer.pokemon) {
        battleStats.push({
          game_id: '', // will be set by pipeline
          player_id: playerId,
          pokemon_name: poke.pokemon_name,
          was_brought: poke.was_brought,
          was_lead: poke.was_lead,
          kos_dealt: poke.kos_dealt,
          was_koed: poke.was_koed,
          moves_used: poke.moves_used,
          turns_active: poke.turns_active,
        });
      }
    }

    // 5. Run the shared game pipeline
    const result = await recordGameResult({
      match_id: body.match_id,
      winner_id: winnerId,
      replay_url: body.replay_url,
      source: 'ps_replay',
      battle_stats: battleStats,
      submitter_id: player.playerId,
      is_admin: player.isAdmin,
    });

    // 6. Shared post-record side effects (revalidate, notify, AI, aggregates)
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
