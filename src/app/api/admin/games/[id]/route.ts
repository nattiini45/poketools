import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { adminGameEditSchema, formatZodErrors, gameDeleteSchema } from '@/lib/validation';
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
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

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

/**
 * The game change is saved (and audited) but a concurrent write moved the
 * match first, so its status was not re-evaluated (game-pipeline
 * reevaluateMatchStatus). The admin reloads and checks the match status.
 */
function matchStatusConflictResponse(): NextResponse<ApiResult<never>> {
  return NextResponse.json<ApiResult<never>>(
    {
      success: false,
      error: 'The game change was saved, but the match changed at the same moment, so its status was not re-evaluated. Reload the match and check its status.',
      code: 'admin_game_match_status_conflict',
    },
    { status: 409 }
  );
}

function isAuthError(resolved: { game: Game; match: MatchWithPlayers } | ResolveFailure): resolved is ResolveFailure {
  return 'error' in resolved;
}

/**
 * The audit fields of an approved cascade: the game change reset the played later bracket matches (`confirm_downstream`).
 * Empty when it reset none.
 */
function cascadeMetadata(matchIds: readonly string[] | undefined): Record<string, unknown> {
  return matchIds && matchIds.length > 0 ? { cascade: true, downstream_reset_match_ids: [...matchIds] } : {};
}

/**
 * An approved game change that failed AFTER it had reset some later matches leaves those resets behind: they are audited
 * all the same (`completed: false`), as the regenerate-bracket route audits a cascade that stopped half way.
 */
function auditAbandonedCascade(
  action: 'game.delete' | 'game.edit',
  player: { playerId: string; name: string },
  resolved: { game: Game; match: MatchWithPlayers },
  gameId: string,
  matchIds: readonly string[]
): void {
  logAuditEvent({
    actor_id: player.playerId,
    actor_name: player.name,
    action,
    resource_type: 'game',
    resource_id: gameId,
    resource_name: `${resolved.match.player_1_name} vs ${resolved.match.player_2_name} game ${resolved.game.game_number}`,
    metadata: {
      match_id: resolved.match.id,
      tournament_id: resolved.match.tournament_id,
      completed: false,
      ...cascadeMetadata(matchIds),
    },
  });
}

/** DELETE /api/admin/games/[id] — delete a single game */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const player = await requirePlayer();
    const { id } = await params;
    const invalidId = rejectInvalidPathId(id, 'INVALID_GAME_ID');
    if (invalidId) return invalidId;

    const resolved = await resolveAndAuthorize(id, player.playerId, player.isAdmin);
    if (isAuthError(resolved)) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: resolved.error, code: resolved.code },
        { status: resolved.status }
      );
    }

    // Optional JSON body { reason }; an empty or invalid body is {} (older callers send none).
    let rawBody: unknown = {};
    try {
      rawBody = await request.json();
    } catch {
      rawBody = {};
    }
    const parsedBody = gameDeleteSchema.safeParse(rawBody ?? {});
    if (!parsedBody.success) {
      const issues = formatZodErrors(parsedBody.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    // An approved change resets the played later bracket matches first (the delete is otherwise refused with nothing
    // written, 409 game_change_downstream_played); each reset is noted as it commits.
    const resetMatchIds: string[] = [];
    let result: DeleteGameResult | undefined;
    try {
      result = await deleteGame(id, player.playerId, {
        confirmDownstream: parsedBody.data.confirm_downstream === true,
        onDownstreamMatchReset: (matchId) => resetMatchIds.push(matchId),
      });
    } finally {
      if (result === undefined && resetMatchIds.length > 0) {
        auditAbandonedCascade('game.delete', player, resolved, id, resetMatchIds);
      }
    }

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
        ...(parsedBody.data.reason ? { reason: parsedBody.data.reason } : {}),
        ...(result.match_status_conflict ? { match_status_conflict: true } : {}),
        ...cascadeMetadata(result.downstream_reset_match_ids),
        ...(result.stage_already_ended ? { stage_already_ended: true } : {}),
      },
    });

    if (result.match_status_conflict) return matchStatusConflictResponse();

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
    const invalidId = rejectInvalidPathId(id, 'INVALID_GAME_ID');
    if (invalidId) return invalidId;

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

    // An approved change resets the played later bracket matches first (the edit is otherwise refused with nothing
    // written, 409 game_change_downstream_played); each reset is noted as it commits.
    const resetMatchIds: string[] = [];
    let result: EditGameResult | undefined;
    try {
      result = await editGame(
        {
          game_id: id,
          winner_id: body.winner_id,
          battle_stats: body.battle_stats,
          admin_id: player.playerId,
          expected_updated_at: body.expected_updated_at,
        },
        {
          confirmDownstream: body.confirm_downstream === true,
          onDownstreamMatchReset: (matchId) => resetMatchIds.push(matchId),
        }
      );
    } finally {
      if (result === undefined && resetMatchIds.length > 0) {
        auditAbandonedCascade('game.edit', player, resolved, id, resetMatchIds);
      }
    }

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
        ...(result.match_status_conflict ? { match_status_conflict: true } : {}),
        ...cascadeMetadata(result.downstream_reset_match_ids),
        ...(result.stage_already_ended ? { stage_already_ended: true } : {}),
      },
    });

    if (result.match_status_conflict) return matchStatusConflictResponse();

    return NextResponse.json<ApiResult<EditGameResult>>({
      success: true,
      data: result,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to edit game');
  }
}
