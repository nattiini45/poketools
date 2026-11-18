import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { logger } from '@/lib/logger';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { phaseCreateSchema, formatZodErrors } from '@/lib/validation';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { logAuditEvent } from '@/lib/audit/log';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { legacyPhasePersistence, nativePhasePersistence } from '@/lib/league-phase/lifecycle-persistence';
import { createNativePhaseEnrollment } from '@/lib/league-phase/enrollment-services';
import { requireOpenPhaseRouteMode } from '@/lib/league-phase/route-mode';
import { getPhasesBySeasonId } from '@/lib/supabase/queries/league-phases';
import { listRoundStatusesByPhaseIds, type RoundStatusRow } from '@/lib/supabase/queries/phase-rounds';
import { syncStandingsEnrollment } from '@/lib/tournament/enrollment-sync';
import { buildLeaguePhase, assertPhaseNameFree } from '@/lib/tournament/league-phase';
import { addResourceAdmin } from '@/lib/supabase/queries/resource-admins';
import { addPhaseAdmin } from '@/lib/supabase/queries/phase-admins';
import { expireSeasonReads } from '@/lib/revalidation';
import { assertRulesetUsableForCreate } from '@/lib/ruleset-studio/pin-change';
import { assertSeasonPhasesFree } from '@/lib/format-studio/phase-guards';
import type { ApiResult } from '@/types/api';
import type { LeaguePhase } from '@/types/season';

const { listBySeason: getStagesBySeasonId, rounds: getRoundsByTournament } = legacyPhasePersistence;

interface RouteParams {
  params: Promise<{ id: string }>;
}

// Public: no auth required
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    // A malformed id names no row: 404 before the query (Postgres would reject the filter with a 500).
    const invalidId = rejectInvalidPathId(id, 'INVALID_SEASON_ID');
    if (invalidId) return invalidId;
    const mode = await requireOpenPhaseRouteMode();
    const season = await getSeasonById(id);
    if (!season) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'League not found', code: 'SEASON_NOT_FOUND' },
        { status: 404 }
      );
    }

    if (mode === 'phase') {
      const stages = await getPhasesBySeasonId(season.id);
      const rounds = await listRoundStatusesByPhaseIds(stages.map((stage) => stage.id));
      const byStage = new Map<string, RoundStatusRow[]>();
      for (const round of rounds) {
        const existing = byStage.get(round.phase_id);
        if (existing) existing.push(round);
        else byStage.set(round.phase_id, [round]);
      }
      return NextResponse.json<ApiResult<LeaguePhase[]>>({
        success: true,
        data: stages.map((stage) => buildLeaguePhase(stage, byStage.get(stage.id) ?? [])),
      });
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
    const native = (await requireOpenPhaseRouteMode()) === 'phase';
    const storage = native ? nativePhasePersistence : legacyPhasePersistence;

    const season = await getSeasonById(id);
    if (!season) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'League not found', code: 'SEASON_NOT_FOUND' },
        { status: 404 }
      );
    }

    // A league with an attached format gets its phases from the format only (409 format_phase_owned).
    await assertSeasonPhasesFree(id);

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
    const seasonId = season.id;
    const existing = await storage.listBySeason(seasonId);

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

    const wouldShift = existing.filter((phase) => phase.stage_order >= insertAt);
    if (wouldShift.some((phase) => phase.status !== 'upcoming')) {
      throw new UserFacingError(
        'Cannot insert a phase before stages that have already started',
        { code: 'PHASE_INSERT_LOCKED' }
      );
    }
    if (native && wouldShift.length > 0) {
      throw new UserFacingError('Inserting a phase before existing phases is not available yet.', {
        code: 'phase_insert_unavailable', status: 503,
      });
    }

    // The shift, the insert and the enrollment sync commit one by one: the public reads expire in a finally, with the
    // phases whose order moved and the new phase, whichever step is the last to succeed.
    const touchedIds: string[] = [];
    let created: Awaited<ReturnType<typeof storage.create>>;
    try {
      if (wouldShift.length > 0) {
        touchedIds.push(...wouldShift.map((phase) => phase.id));
        await legacyPhasePersistence.shiftOrders(seasonId, insertAt, 1);
      }

      created = await storage.create({
        name: body.name,
        description: body.description,
        season_id: seasonId,
        bracket_type: body.bracket_type,
        ruleset_id: body.ruleset_id,
        best_of_default: body.best_of_default,
        bo_overrides: body.bo_overrides,
        is_doubles: body.is_doubles,
        team_visibility: body.team_visibility,
        stage_order: insertAt,
        advancement_rule: body.advancement_rule ?? null,
      });
      touchedIds.push(created.id);

      if (!admin.isAdmin) {
        try {
          if (native) await addPhaseAdmin(admin.playerId, created.id);
          else await addResourceAdmin(admin.playerId, 'tournament', created.id);
        } catch (adminErr) {
          logger.error('api/seasons', 'Failed to assign resource admin', {
            seasonId,
            ...(native ? { phaseId: created.id } : { tournamentId: created.id }),
            playerId: admin.playerId,
            error: adminErr,
          });
        }
      }

      if (native) await createNativePhaseEnrollment().sync(seasonId, created.id);
      else await syncStandingsEnrollment(seasonId, created.id);
    } finally {
      expireSeasonReads(seasonId, native ? { phaseIds: touchedIds } : touchedIds);
    }

    const withDetails = native
      ? await nativePhasePersistence.getWithDetails(created.id, seasonId)
      : await legacyPhasePersistence.getWithDetails(created.id);
    const rounds = native ? await listRoundStatusesByPhaseIds([created.id]) : await getRoundsByTournament(created.id);
    const phase = buildLeaguePhase(withDetails!, rounds);

    logAuditEvent({
      action: 'phase.create',
      actor_id: admin.playerId,
      actor_name: admin.name,
      resource_type: 'season',
      resource_id: seasonId,
      resource_name: season.name,
      metadata: { phase_id: created.id, phase_name: created.name },
    });

    return NextResponse.json<ApiResult<LeaguePhase>>(
      { success: true, data: phase },
      { status: 201 }
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to create phase');
  }
}
