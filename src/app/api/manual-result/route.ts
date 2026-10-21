import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { recordGameResult } from '@/lib/pkmn/game-pipeline';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { emitMatchResultEffects } from '@/lib/match/result-effects';
import { createMomentsBatch } from '@/lib/supabase/queries/broadcast-moments';
import { manualResultSchema, formatZodErrors } from '@/lib/validation';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import { MOMENTS_NOT_SAVED_WARNING, type ManualResultMomentsOutcome } from '@/lib/broadcast/moment-limits';
import type { ApiResult } from '@/types/api';
import type { BattleStatInsert } from '@/types/game';

export async function POST(request: NextRequest) {
  try {
    const player = await requirePlayer();

    const rateResult = await checkRateLimit('manual-result', player.playerId, { limit: 20, windowSeconds: 60 * 60 });
    if (!rateResult.allowed) return rateLimitedResponse(rateResult.retryAfterSeconds);

    const rawBody = await request.json();
    const parsed = manualResultSchema.safeParse(rawBody);
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }
    const body = parsed.data;

    // Validate match exists and winner is a participant
    const match = await getMatchById(body.match_id);
    if (!match) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Match not found', code: 'match_not_found' },
        { status: 404 }
      );
    }

    if (body.winner_id !== match.player_1_id && body.winner_id !== match.player_2_id) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Winner must be a match participant', code: 'manual_result_winner_not_participant' },
        { status: 400 }
      );
    }

    // Build battle stat inserts from manual form data
    const battleStats: BattleStatInsert[] = [];
    for (const playerStats of body.pokemon_stats) {
      // Validate player is a match participant
      if (playerStats.player_id !== match.player_1_id && playerStats.player_id !== match.player_2_id) {
        return NextResponse.json<ApiResult<never>>(
          {
            success: false,
            error: `Player ${playerStats.player_id} is not in this match`,
            code: 'match_player_not_participant',
            params: { playerId: playerStats.player_id },
          },
          { status: 400 }
        );
      }

      for (const poke of playerStats.pokemon) {
        battleStats.push({
          game_id: '', // set by pipeline
          player_id: playerStats.player_id,
          pokemon_name: poke.pokemon_name,
          was_brought: poke.was_brought ?? true,
          was_lead: poke.was_lead ?? false,
          kos_dealt: poke.kos_dealt ?? 0,
          was_koed: poke.was_koed ?? false,
          moves_used: poke.moves_used ?? [],
          turns_active: poke.turns_active ?? 0,
        });
      }
    }

    const result = await recordGameResult({
      match_id: body.match_id,
      winner_id: body.winner_id,
      screenshot_url: body.screenshot_url,
      source: 'manual',
      battle_stats: battleStats,
      submitter_id: player.playerId,
      is_admin: player.isAdmin,
    });

    // Broadcast moments marked in the tracker. The match, game and author are
    // server-owned: every row is bound to the match and game just recorded and
    // to the caller, never to ids from the request. The game is already
    // committed, so a failed moment insert does not fail the request (a client
    // retry would record the game twice): it is logged with its context and
    // reported to the tracker as a catalogued warning.
    const momentsOutcome: ManualResultMomentsOutcome = { moments_saved: 0 };
    if (body.moments && body.moments.length > 0) {
      const count = body.moments.length;
      try {
        await createMomentsBatch(
          body.moments.map((m) => ({
            moment_type: m.moment_type,
            turn_number: m.turn_number ?? null,
            description: m.description ?? null,
            pokemon_name: m.pokemon_name ?? null,
            timestamp: m.timestamp,
            match_id: body.match_id,
            game_id: result.game_id,
            created_by: player.playerId,
          }))
        );
        momentsOutcome.moments_saved = count;
      } catch (momentsError) {
        console.error(
          '[manual-result] failed to save broadcast moments',
          { match_id: body.match_id, game_id: result.game_id, count },
          momentsError
        );
        momentsOutcome.warning = {
          code: MOMENTS_NOT_SAVED_WARNING,
          error: `The game was recorded, but its ${count} marked moment${count === 1 ? '' : 's'} could not be saved. The failure was logged.`,
          params: { count },
        };
      }
    }

    // Shared post-record side effects (revalidate, notify, AI, aggregates)
    await emitMatchResultEffects(body.match_id, {
      boReached: result.bo_reached,
      requestCookie: request.headers.get('cookie'),
    });

    return NextResponse.json<ApiResult<typeof result & ManualResultMomentsOutcome>>({
      success: true,
      data: { ...result, ...momentsOutcome },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to submit manual result');
  }
}
