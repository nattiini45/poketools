import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { cascadeActionSchema, formatZodErrors } from '@/lib/validation';
import {
  getTournamentById,
  getParticipants,
} from '@/lib/supabase/queries/tournaments';
import { regenerateEliminationBracket } from '@/lib/tournament/bracket-generate';
import { expireTournamentReads } from '@/lib/revalidation';
import type { ApiResult } from '@/types/api';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** POST /api/tournaments/[id]/regenerate-bracket — wipe and rebuild SE/DE bracket */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const admin = await requireResourceAdmin('tournament', id);
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
        { success: false, error: 'Bracket regeneration only applies to elimination formats', code: 'bracket_regenerate_elim_only' },
        { status: 400 }
      );
    }

    let rawBody: unknown = {};
    try {
      rawBody = await request.json();
    } catch {
      rawBody = {};
    }
    const parsed = cascadeActionSchema.safeParse(rawBody ?? {});
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const participants = await getParticipants(id);
    const result = await regenerateEliminationBracket(tournament, participants, {
      cascade: parsed.data.cascade === true,
      adminId: admin.playerId,
    });
    expireTournamentReads(id, tournament.season_id);

    return NextResponse.json<ApiResult<typeof result>>({
      success: true,
      data: result,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to regenerate bracket');
  }
}
