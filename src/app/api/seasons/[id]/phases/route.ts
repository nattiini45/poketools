import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { phaseCreateSchema, formatZodErrors } from '@/lib/validation';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { logAuditEvent } from '@/lib/audit/log';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import {
  getStagesBySeasonId,
  createTournament,
  shiftStageOrders,
  getTournamentWithDetails,
} from '@/lib/supabase/queries/tournaments';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { syncStandingsEnrollment } from '@/lib/tournament/enrollment-sync';
import { buildLeaguePhase, assertPhaseNameFree } from '@/lib/tournament/league-phase';
import { addResourceAdmin } from '@/lib/supabase/queries/resource-admins';
import { expireSeasonReads } from '@/lib/revalidation';
import { assertRulesetUsableForCreate } from '@/lib/ruleset-studio/pin-change';
import type { ApiResult } from '@/types/api';
import type { LeaguePhase } from '@/types/season';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// Public: league phases are visible like tournament stages
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    // A malformed id names no row: 404 before the query (Postgres would reject the filter with a 500).
    const invalidId = rejectInvalidPathId(id, 'INVALID_SEASON_ID');
    if (invalidId) return invalidId;
    const season = await getSeasonById(id);
    if (!season) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'League not found', code: 'SEASON_NOT_FOUND' },
        { status: 404 }
      );
    }

    const stages = await getStagesBySeasonId(id);
    const phases: LeaguePhase[] = await Promise.all(
      stages.map(async (stage) => {
        const rounds = await getRoundsByTournament(stage.id);
        return buildLeaguePhase(stage, rounds);
      })
    );

    return NextResponse.json<ApiResult<LeaguePhase[]>>({
      success: true,
      data: phases,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch phases');
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const admin = await requireResourceAdmin('season', id);
    const invalidId = rejectInvalidPathId(id, 'INVALID_SEASON_ID');
    if (invalidId) return invalidId;

    const season = await getSeasonById(id);
    if (!season) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'League not found', code: 'SEASON_NOT_FOUND' },
        { status: 404 }
      );
    }

    const rawBody = await request.json();
    const parsed = phaseCreateSchema.safeParse(rawBody);
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const body = parsed.data;
    const existing = await getStagesBySeasonId(id);

    // Names are unique per league (API-only: the table has no constraint).
    // Checked before anything is shifted, so a refusal leaves the league as is.
    assertPhaseNameFree(body.name, existing);

    // The ruleset is a pin the caller must be allowed to use; refused here for the same reason.
    await assertRulesetUsableForCreate(admin, body.ruleset_id);

    // Positions run from the highest stage_order, not from the phase count: a
    // league whose middle phase was deleted has a gap, and counting phases
    // would hand the new phase an order another phase already holds.
    const maxOrder = Math.max(0, ...existing.map((phase) => phase.stage_order));
    const insertAt = body.insert_at ?? maxOrder + 1;

    if (insertAt < 1 || insertAt > maxOrder + 1) {
      throw new UserFacingError('insert_at is out of range', {
        code: 'PHASE_INSERT_INVALID',
        status: 400,
      });
    }

    if (insertAt <= maxOrder) {
      const wouldShift = existing.filter((phase) => phase.stage_order >= insertAt);
      const locked = wouldShift.filter((phase) => phase.status !== 'upcoming');
      if (locked.length > 0) {
        throw new UserFacingError(
          'Cannot insert a phase before stages that have already started',
          { code: 'PHASE_INSERT_LOCKED' }
        );
      }
      await shiftStageOrders(id, insertAt, 1);
    }

    const tournament = await createTournament({
      name: body.name,
      description: body.description,
      season_id: id,
      bracket_type: body.bracket_type,
      ruleset_id: body.ruleset_id,
      best_of_default: body.best_of_default,
      bo_overrides: body.bo_overrides,
      is_doubles: body.is_doubles,
      team_visibility: body.team_visibility,
      stage_order: insertAt,
      advancement_rule: body.advancement_rule ?? null,
    });

    if (!admin.isAdmin) {
      try {
        await addResourceAdmin(admin.playerId, 'tournament', tournament.id);
      } catch (adminErr) {
        console.error('Failed to assign resource admin:', adminErr);
      }
    }

    await syncStandingsEnrollment(id, tournament.id);
    expireSeasonReads(id, [tournament.id]);

    const withDetails = await getTournamentWithDetails(tournament.id);
    const rounds = await getRoundsByTournament(tournament.id);
    const phase = buildLeaguePhase(withDetails!, rounds);

    logAuditEvent({
      action: 'phase.create',
      actor_id: admin.playerId,
      actor_name: admin.name,
      resource_type: 'season',
      resource_id: id,
      resource_name: season.name,
      metadata: { phase_id: tournament.id, phase_name: tournament.name },
    });

    return NextResponse.json<ApiResult<LeaguePhase>>(
      { success: true, data: phase },
      { status: 201 }
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to create phase');
  }
}
