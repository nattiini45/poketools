import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { UserFacingError } from '@/lib/api/user-facing-error';
import {
  getTournamentById,
  getParticipants,
  updateParticipantSeeds,
} from '@/lib/supabase/queries/tournaments';
import { SeedUpdatePartialError } from '@/lib/tournament/seed-errors';
import { getPlayerRatingsBatch } from '@/lib/supabase/queries/ratings';
import { assertPhaseEditable } from '@/lib/tournament/league-phase';
import { expireTournamentReads } from '@/lib/revalidation';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string; phaseId: string }>;
}

async function assertPhaseInSeason(seasonId: string, phaseId: string) {
  const phase = await getTournamentById(phaseId);
  if (!phase || phase.season_id !== seasonId) {
    throw new UserFacingError('Phase not found in this league', {
      code: 'PHASE_NOT_FOUND',
      status: 404,
    });
  }
  return phase;
}

/** POST /api/seasons/[id]/phases/[phaseId]/participants/seed-by-rating */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id, phaseId } = await params;
    await requireResourceAdmin('season', id);
    const phase = await assertPhaseInSeason(id, phaseId);
    assertPhaseEditable(phase, 'participants');

    const participants = await getParticipants(phaseId);
    if (participants.length === 0) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'No participants to seed', code: 'phase_seed_no_participants' },
        { status: 400 }
      );
    }

    const ratings = await getPlayerRatingsBatch(participants.map((p) => p.id));

    const sorted = [...participants].sort((a, b) => {
      const ra = ratings.get(a.id)?.rating ?? 1500;
      const rb = ratings.get(b.id)?.rating ?? 1500;
      if (rb !== ra) return rb - ra;
      return a.name.localeCompare(b.name);
    });

    const seeds = sorted.map((p, index) => ({
      player_id: p.id,
      seed: index + 1,
    }));

    try {
      await updateParticipantSeeds(phaseId, seeds);
    } catch (err) {
      // A partial write already changed some seeds: expire the cached reads so
      // the admin and viewers see the state that now needs a re-save.
      if (err instanceof SeedUpdatePartialError) expireTournamentReads(phaseId, id);
      throw err;
    }
    expireTournamentReads(phaseId, id);

    return NextResponse.json<ApiResult<{ seeds: typeof seeds }>>({
      success: true,
      data: { seeds },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to seed by rating');
  }
}
