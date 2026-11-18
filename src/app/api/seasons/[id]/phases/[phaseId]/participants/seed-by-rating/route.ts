import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { loadPhaseRosterScope } from '@/lib/league-phase/roster-scope';
import { SeedUpdatePartialError } from '@/lib/tournament/seed-errors';
import { getPlayerRatingsBatch } from '@/lib/supabase/queries/ratings';
import { assertPhaseEditable } from '@/lib/tournament/league-phase';
import { auditRosterOverride } from '@/lib/format-studio/roster-override';
import { expirePhaseReads, expireTournamentReads } from '@/lib/revalidation';
import type { ApiResult } from '@/types/api';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

interface RouteParams {
  params: Promise<{ id: string; phaseId: string }>;
}

/** The JSON body of a call that may have none (the plain seed-by-rating has none): a body that is not JSON asks for no override. */
async function optionalJsonBody(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

/**
 * POST /api/seasons/[id]/phases/[phaseId]/participants/seed-by-rating
 *
 * Re-seeds the roster, so on a format phase that has started it is refused like the other roster writes (409
 * `format_phase_owned`) unless the optional body forces it: `{ "force": true, "reason": "…" }`.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, phaseId: requestedPhaseId } = await params;
    const admin = await requireResourceAdmin('season', id);
    const invalidId = rejectInvalidPathId(id, 'INVALID_SEASON_ID');
    if (invalidId) return invalidId;
    const invalidPhaseId = rejectInvalidPathId(requestedPhaseId, 'INVALID_PHASE_ID');
    if (invalidPhaseId) return invalidPhaseId;
    const { mode, phase, phaseId, seasonId, persistence, assertRosterOpen } = await loadPhaseRosterScope(id, requestedPhaseId);
    assertPhaseEditable(phase, 'participants');
    const override = await assertRosterOpen(await optionalJsonBody(request));
    const expire = () => mode === 'phase' ? expirePhaseReads(phaseId, seasonId) : expireTournamentReads(phaseId, seasonId);

    const participants = await persistence.participants(phaseId);
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
      await persistence.updateSeeds(phaseId, seeds);
    } catch (err) {
      // A partial write already changed some seeds: expire the cached reads so
      // the admin and viewers see the state that now needs a re-save.
      if (err instanceof SeedUpdatePartialError) expire();
      throw err;
    }
    expire();
    if (override) auditRosterOverride(admin, seasonId, phase, override, 'seed_by_rating', { seeded: seeds.length });

    return NextResponse.json<ApiResult<{ seeds: typeof seeds }>>({
      success: true,
      data: { seeds },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to seed by rating');
  }
}
