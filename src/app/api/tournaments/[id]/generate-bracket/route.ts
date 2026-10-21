import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import {
  getTournamentById,
  getParticipants,
} from '@/lib/supabase/queries/tournaments';
import { getSeasonById, updateSeason } from '@/lib/supabase/queries/seasons';
import { generateEliminationBracket } from '@/lib/tournament/bracket-generate';
import { emitDiscordEvent } from '@/lib/discord/notify';
import { emitSocialEvent } from '@/lib/social/notify';
import { expireTournamentReads } from '@/lib/revalidation';
import type { ApiResult } from '@/types/api';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/tournaments/[id]/generate-bracket
 * Admin: generate the full elimination bracket (SE/DE).
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
        { success: false, error: 'Full bracket generation only applies to elimination formats', code: 'bracket_generate_elim_only' },
        { status: 400 }
      );
    }

    if (tournament.status === 'completed') {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Tournament is already completed', code: 'tournament_already_completed' },
        { status: 400 }
      );
    }

    const participants = await getParticipants(id);
    const result = await generateEliminationBracket(tournament, participants);

    if (tournament.season_id) {
      const season = await getSeasonById(tournament.season_id);
      if (season && season.status === 'upcoming') {
        await updateSeason(season.id, { status: 'active' });
      }
    }
    expireTournamentReads(id, tournament.season_id);

    const roundPayload = {
      event_type: 'round_generated' as const,
      tournament_id: id,
      season_id: tournament.season_id,
      data: {
        kind: 'round_generated' as const,
        tournament_name: tournament.name,
        round_name: 'Full bracket',
        pairings: [],
      },
    };
    void emitDiscordEvent(roundPayload);
    void emitSocialEvent(roundPayload);

    return NextResponse.json<ApiResult<typeof result>>(
      { success: true, data: result },
      { status: 201 }
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to generate bracket');
  }
}
