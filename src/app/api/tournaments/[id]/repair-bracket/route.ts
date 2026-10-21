import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import {
  getTournamentById,
  getParticipants,
} from '@/lib/supabase/queries/tournaments';
import { repairBracket } from '@/lib/tournament/bracket-propagation';
import { expireTournamentReads } from '@/lib/revalidation';
import type { ApiResult } from '@/types/api';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/tournaments/[id]/repair-bracket
 * Admin: re-run bye resolution + slot materialization to heal a bracket
 * after a failed propagation. Admin UI: RoundManager "Repair bracket".
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    await requireResourceAdmin('tournament', id);
    const invalidId = rejectInvalidPathId(id, 'INVALID_TOURNAMENT_ID');
    if (invalidId) return invalidId;

    const tournament = await getTournamentById(id);
    if (!tournament) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Tournament not found', code: 'tournament_not_found' },
        { status: 404 }
      );
    }

    if (tournament.bracket_type !== 'single_elim' && tournament.bracket_type !== 'double_elim') {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Bracket repair only applies to elimination formats', code: 'bracket_repair_elim_only' },
        { status: 400 }
      );
    }

    const participants = await getParticipants(id);
    const result = await repairBracket(tournament, participants);
    expireTournamentReads(id, tournament.season_id);

    return NextResponse.json<ApiResult<typeof result>>({
      success: true,
      data: result,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to repair bracket');
  }
}
