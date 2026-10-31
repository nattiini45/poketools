import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import { getRoundById, deleteRound, getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { deleteMatchesByRound, getMatchesByRound } from '@/lib/supabase/queries/matches';
import { getGamesByMatch } from '@/lib/supabase/queries/games';
import { resetMatch } from '@/lib/pkmn/game-pipeline';
import { rebuildAggregatesForScope } from '@/lib/match/aggregate-rebuild';
import { revalidateMatchPages } from '@/lib/revalidation';
import { updateTournament } from '@/lib/supabase/queries/tournaments';
import { logAuditEvent } from '@/lib/audit/log';
import type { ApiResult } from '@/types/api';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * DELETE /api/admin/rounds/[id]
 * Delete a round when it is the latest round or has zero games across all matches.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const player = await requirePlayer();
    const { id } = await params;
    const invalidId = rejectInvalidPathId(id, 'INVALID_ROUND_ID');
    if (invalidId) return invalidId;

    const round = await getRoundById(id);
    if (!round) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Round not found', code: 'round_not_found' },
        { status: 404 }
      );
    }

    const hasAdminAccess =
      player.isAdmin ||
      (await isResourceAdminFor(player.playerId, 'tournament', round.tournament_id));

    if (!hasAdminAccess) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Admin access required', code: 'forbidden' },
        { status: 403 }
      );
    }

    const allRounds = await getRoundsByTournament(round.tournament_id);
    const isStructureElim = allRounds.some((r) => r.bracket_side != null);
    if (isStructureElim) {
      throw new UserFacingError(
        'Structure-generated elimination rounds cannot be deleted individually. Use Regenerate Bracket to rebuild the slot graph.',
        { code: 'STRUCTURE_ELIM_ROUND_DELETE', status: 400 }
      );
    }

    const latestRoundNumber = Math.max(...allRounds.map((r) => r.round_number));
    const isLatest = round.round_number === latestRoundNumber;

    const matches = await getMatchesByRound(id);
    let totalGames = 0;
    for (const match of matches) {
      const games = await getGamesByMatch(match.id);
      totalGames += games.length;
    }

    if (!isLatest && totalGames > 0) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: 'Only the latest round or rounds with zero games can be deleted',
          code: 'round_delete_not_allowed',
        },
        { status: 400 }
      );
    }

    const nonScheduled = matches.filter((m) => m.status !== 'scheduled');
    for (const match of nonScheduled) {
      await resetMatch(match.id, player.playerId);
    }

    // Through the query layer: it releases the matches' team rows first, so a match-prep row never survives as a second
    // planned row of its player. It reads the round's matches itself, in pages, and deletes on the round id.
    await deleteMatchesByRound(id);

    await deleteRound(id);

    const remaining = allRounds.filter((r) => r.id !== id);
    if (remaining.length > 0) {
      const maxRound = Math.max(...remaining.map((r) => r.round_number));
      await updateTournament(round.tournament_id, { current_round: maxRound });
    } else {
      await updateTournament(round.tournament_id, { current_round: 0 });
    }

    await revalidateMatchPages(round.tournament_id);

    try {
      await rebuildAggregatesForScope('tournament', round.tournament_id);
    } catch (err) {
      console.error('round delete aggregate rebuild failed:', err);
    }

    logAuditEvent({
      actor_id: player.playerId,
      actor_name: player.name,
      action: 'round.delete',
      resource_type: 'round',
      resource_id: id,
      resource_name: round.name,
      metadata: { tournament_id: round.tournament_id },
    });

    return NextResponse.json<ApiResult<{ deleted: true }>>({
      success: true,
      data: { deleted: true },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to delete round');
  }
}
