import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { seasonAdvanceSchema, formatZodErrors } from '@/lib/validation';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getStagesBySeasonId } from '@/lib/supabase/queries/tournaments';
import { assertEnrollmentSyncAllowed, syncStandingsEnrollment } from '@/lib/tournament/enrollment-sync';
import { emitDiscordEvent } from '@/lib/discord/notify';
import { emitSocialEvent } from '@/lib/social/notify';
import { expireSeasonReads } from '@/lib/revalidation';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/seasons/[id]/advance
 *
 * Delegates to standings enrollment on the next upcoming phase.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    await requireResourceAdmin('season', id);

    const rawBody = request.headers.get('content-length') === '0'
      ? {}
      : await request.json();
    const parsed = seasonAdvanceSchema.safeParse(rawBody);
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const season = await getSeasonById(id);
    if (!season) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'League not found', code: 'SEASON_NOT_FOUND' },
        { status: 404 }
      );
    }

    const stages = await getStagesBySeasonId(id);
    if (stages.length < 2) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Need at least 2 phases to advance', code: 'advance_needs_two_phases' },
        { status: 400 }
      );
    }

    let sourceStage = null;
    let targetStage = null;

    for (let i = 0; i < stages.length - 1; i++) {
      if (stages[i].status === 'completed' && stages[i + 1].status === 'upcoming') {
        sourceStage = stages[i];
        targetStage = stages[i + 1];
        break;
      }
    }

    if (!sourceStage || !targetStage) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: 'No valid phase transition found. Need a completed phase followed by an upcoming phase.',
          code: 'advance_no_transition',
        },
        { status: 400 }
      );
    }

    await assertEnrollmentSyncAllowed(targetStage.id, parsed.data.force ?? false);

    const result = await syncStandingsEnrollment(id, targetStage.id, {
      source_phase_id: sourceStage.id,
      force: parsed.data.force,
    });
    expireSeasonReads(id, [sourceStage.id, targetStage.id]);

    const summary = `Enrolled ${result.enrolled_count} players from ${result.source_phase_name ?? sourceStage.name}`;

    const advancePayload = {
      event_type: 'season_advanced' as const,
      tournament_id: sourceStage.id,
      season_id: id,
      data: {
        kind: 'season_advanced' as const,
        season_name: season.name,
        source_stage: sourceStage.name,
        target_stage: targetStage.name,
        advanced_count: result.enrolled_count,
        summary,
      },
    };
    void emitDiscordEvent(advancePayload);
    void emitSocialEvent(advancePayload);

    return NextResponse.json<ApiResult<{
      advanced_count: number;
      summary: string;
      source_stage: string;
      target_stage: string;
    }>>({
      success: true,
      data: {
        advanced_count: result.enrolled_count,
        summary,
        source_stage: sourceStage.name,
        target_stage: targetStage.name,
      },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to advance players');
  }
}
