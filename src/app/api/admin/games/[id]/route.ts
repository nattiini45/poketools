import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { adminGameEditSchema, formatZodErrors } from '@/lib/validation';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import { getGameById } from '@/lib/supabase/queries/games';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { deleteGame, editGame } from '@/lib/pkmn/game-pipeline';
import { revalidateMatchPages } from '@/lib/revalidation';
import { logAuditEvent } from '@/lib/audit/log';
import type { ApiErrorCode } from '@/i18n/messages/errors';
import type { ApiResult } from '@/types/api';
import type { DeleteGameResult, EditGameResult } from '@/types/game';
import type { Game } from '@/types/game';
import type { MatchWithPlayers } from '@/types/match';

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface ResolveFailure {
  error: string;
  code: ApiErrorCode;
  status: number;
}

/**
 * Resolve game → match → tournament and check admin access.
 * Returns null + sends response on failure, or game+match on success.
 */
async function resolveAndAuthorize(
  gameId: string,
  playerId: string,
  isAdmin: boolean
): Promise<{ game: Game; match: MatchWithPlayers } | ResolveFailure> {
  const game = await getGameById(gameId);
  if (!game) return { error: 'Game not found', code: 'game_not_found', status: 404 };

  const match = await getMatchById(game.match_id);
  if (!match) return { error: 'Match not found', code: 'match_not_found', status: 404 };

  const hasAccess = isAdmin ||
    await isResourceAdminFor(playerId, 'tournament', match.tournament_id);

  if (!hasAccess) return { error: 'Admin access required', code: 'forbidden', status: 403 };

  return { game, match };
}

function isAuthError(resolved: { game: Game; match: MatchWithPlayers } | ResolveFailure): resolved is ResolveFailure {
  return 'error' in resolved;
}

/** DELETE /api/admin/games/[id] — delete a single game */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const player = await requirePlayer();
    const { id } = await params;

    const resolved = await resolveAndAuthorize(id, player.playerId, player.isAdmin);
    if (isAuthError(resolved)) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: resolved.error, code: resolved.code },
        { status: resolved.status }
      );
    }

    const result = await deleteGame(id, player.playerId);

    await revalidateMatchPages(resolved.match.tournament_id, resolved.match.id);

    logAuditEvent({
      actor_id: player.playerId,
      actor_name: player.name,
      action: 'game.delete',
      resource_type: 'game',
      resource_id: id,
      resource_name: `${resolved.match.player_1_name} vs ${resolved.match.player_2_name} game ${resolved.game.game_number}`,
      changes: {
        winner_id: { before: resolved.game.winner_id, after: null },
      },
      metadata: {
        match_id: resolved.match.id,
        tournament_id: resolved.match.tournament_id,
        games_remaining: result.games_remaining,
      },
    });

    return NextResponse.json<ApiResult<DeleteGameResult>>({
      success: true,
      data: result,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to delete game');
  }
}

/** PATCH /api/admin/games/[id] — edit game winner and/or battle stats */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const player = await requirePlayer();
    const { id } = await params;

    const resolved = await resolveAndAuthorize(id, player.playerId, player.isAdmin);
    if (isAuthError(resolved)) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: resolved.error, code: resolved.code },
        { status: resolved.status }
      );
    }

    const rawBody = await request.json();
    const zodResult = adminGameEditSchema.safeParse(rawBody);

    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const body = zodResult.data;

    if (!body.winner_id && !body.battle_stats) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Provide winner_id and/or battle_stats to update', code: 'game_edit_empty' },
        { status: 400 }
      );
    }

    const result = await editGame({
      game_id: id,
      winner_id: body.winner_id,
      battle_stats: body.battle_stats,
      admin_id: player.playerId,
    });

    await revalidateMatchPages(resolved.match.tournament_id, resolved.match.id);

    logAuditEvent({
      actor_id: player.playerId,
      actor_name: player.name,
      action: 'game.edit',
      resource_type: 'game',
      resource_id: id,
      resource_name: `${resolved.match.player_1_name} vs ${resolved.match.player_2_name} game ${resolved.game.game_number}`,
      changes: body.winner_id && body.winner_id !== resolved.game.winner_id
        ? { winner_id: { before: resolved.game.winner_id, after: body.winner_id } }
        : undefined,
      metadata: {
        match_id: resolved.match.id,
        tournament_id: resolved.match.tournament_id,
        battle_stats_replaced: Boolean(body.battle_stats),
        match_status: result.match_status,
        match_winner_id: result.match_winner_id,
      },
    });

    return NextResponse.json<ApiResult<EditGameResult>>({
      success: true,
      data: result,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to edit game');
  }
}
