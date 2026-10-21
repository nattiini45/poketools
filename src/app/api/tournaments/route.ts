import { NextRequest, NextResponse } from 'next/server';
import { requireAnyAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { tournamentCreateSchema, formatZodErrors } from '@/lib/validation';
import {
  listTournaments,
  listArchivedTournaments,
  getStagesBySeasonId,
  createTournament,
} from '@/lib/supabase/queries/tournaments';
import { addResourceAdmin } from '@/lib/supabase/queries/resource-admins';
import { expireTournamentReads } from '@/lib/revalidation';
import type { ApiResult } from '@/types/api';
import type { TournamentWithDetails } from '@/types/tournament';

// Public — no auth required (archived=true requires admin)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const seasonId = searchParams.get('season_id');
    const archived = searchParams.get('archived') === 'true';

    if (archived) {
      await requireAnyAdmin();
      const tournaments = await listArchivedTournaments();
      return NextResponse.json<ApiResult<TournamentWithDetails[]>>({
        success: true,
        data: tournaments,
      });
    }

    const tournaments = seasonId
      ? await getStagesBySeasonId(seasonId)
      : await listTournaments();
    return NextResponse.json<ApiResult<TournamentWithDetails[]>>({
      success: true,
      data: tournaments,
    });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to fetch tournaments');
  }
}

export async function POST(request: NextRequest) {
  try {
    const player = await requireAnyAdmin();
    const rawBody = await request.json();
    const zodResult = tournamentCreateSchema.safeParse(rawBody);

    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    if (zodResult.data.season_id) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: 'League phases must be created via POST /api/seasons/{id}/phases',
          code: 'TOURNAMENT_SEASON_ID_DEPRECATED',
        },
        { status: 400 }
      );
    }

    const body = zodResult.data;

    const tournament = await createTournament(body);
    expireTournamentReads(tournament.id);

    // Auto-assign resource admin for non-site-admins (best-effort — don't fail the request)
    if (!player.isAdmin) {
      try {
        await addResourceAdmin(player.playerId, 'tournament', tournament.id);
      } catch (adminErr) {
        console.error('Failed to assign resource admin:', adminErr);
      }
    }

    return NextResponse.json<ApiResult<typeof tournament>>(
      { success: true, data: tournament },
      { status: 201 }
    );
  } catch (error) {
    return safeErrorResponse(error, 'Failed to create tournament');
  }
}
