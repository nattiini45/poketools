import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { recordGameResult } from '@/lib/pkmn/game-pipeline';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import { emitMatchResultEffects } from '@/lib/match/result-effects';
import { replayImportSchema, formatZodErrors } from '@/lib/validation';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import { logAuditEvent } from '@/lib/audit/log';
import type { ApiResult } from '@/types/api';
import type { BattleStatInsert } from '@/types/game';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/admin/matches/[id]/replay-import
 *
 * Admin/organizer-only. Records a game from replay-parsed but MANUALLY ASSIGNED
 * stats — deliberately skipping the username legibility gate so an organizer can
 * import a replay where a sub played under a different Showdown name. The two
 * sides must still be assigned to the two registered match participants. Audited.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const player = await requirePlayer();

    const rateResult = checkRateLimit(`replay-import:${player.playerId}`, 20, 60 * 60 * 1000);
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
    const zodResult = replayImportSchema.safeParse(rawBody);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }
    const body = zodResult.data;

    // Winner must be one of the two registered participants.
    if (body.winner_id !== match.player_1_id && body.winner_id !== match.player_2_id) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Winner must be a match participant', code: 'replay_import_winner_not_participant' },
        { status: 400 }
      );
    }

    // Build battle stat inserts; every assigned player must be a participant.
    const battleStats: BattleStatInsert[] = [];
    for (const playerStats of body.pokemon_stats) {
      if (
        playerStats.player_id !== match.player_1_id &&
        playerStats.player_id !== match.player_2_id
      ) {
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

    // is_admin: true — the route already authorized the organizer for this match,
    // so the pipeline's participant check is intentionally bypassed.
    const result = await recordGameResult({
      match_id: matchId,
      winner_id: body.winner_id,
      replay_url: body.replay_url,
      source: 'ps_replay',
      battle_stats: battleStats,
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
        winner_id: body.winner_id,
        legibility_gate_bypassed: true,
        assignments: body.pokemon_stats.map((p) => ({
          player_id: p.player_id,
          pokemon_count: p.pokemon.length,
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
