import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { recordGameResult } from '@/lib/pkmn/game-pipeline';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { emitMatchResultEffects } from '@/lib/match/result-effects';
import { createMomentsBatch } from '@/lib/supabase/queries/broadcast-moments';
import { manualResultSchema, formatZodErrors } from '@/lib/validation';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';
import type { BattleStatInsert } from '@/types/game';
import type { BroadcastMomentInsert } from '@/types/broadcast';

export async function POST(request: NextRequest) {
  try {
    const player = await requirePlayer();

    const rateResult = checkRateLimit(`manual-result:${player.playerId}`, 20, 60 * 60 * 1000);
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

    // Write broadcast moments if provided (fire-and-forget)
    const moments = (body as { moments?: BroadcastMomentInsert[] }).moments;
    if (moments?.length) {
      const gameId = result.game_id;
      void createMomentsBatch(
        moments.map((m) => ({
          ...m,
          game_id: gameId ?? m.game_id ?? null,
          created_by: player.playerId,
        }))
      );
    }

    // Shared post-record side effects (revalidate, notify, AI, aggregates)
    await emitMatchResultEffects(body.match_id, {
      boReached: result.bo_reached,
      requestCookie: request.headers.get('cookie'),
    });

    return NextResponse.json<ApiResult<typeof result>>({
      success: true,
      data: result,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to submit manual result');
  }
}
