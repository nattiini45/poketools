import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import {
  seasonParticipantAddSchema,
  seasonParticipantRemoveSchema,
  tournamentParticipantSeedsSchema,
  phaseParticipantBulkSchema,
  formatZodErrors,
} from '@/lib/validation';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { legacyPhasePersistence, nativePhasePersistence } from '@/lib/league-phase/lifecycle-persistence';
import { requireOpenPhaseRouteMode } from '@/lib/league-phase/route-mode';
import { SeedUpdatePartialError } from '@/lib/tournament/seed-errors';
import { getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { assertPhaseEditable } from '@/lib/tournament/league-phase';
import { assertFormatPhaseRosterOpen, assertSeasonRosterMembers } from '@/lib/format-studio/phase-guards';
import { auditRosterOverride, rosterOverrideOf } from '@/lib/format-studio/roster-override';
import { toPublicTournamentParticipant } from '@/lib/players/public-player';
import { expirePhaseReads, expireTournamentReads } from '@/lib/revalidation';
import type { ApiResult } from '@/types/api';
import type { PublicParticipantWithSeed } from '@/types/tournament';

interface RouteParams {
  params: Promise<{ id: string; phaseId: string }>;
}

async function loadPhaseRosterScope(id: string, requestedPhaseId: string) {
  const mode = await requireOpenPhaseRouteMode();
  const persistence = mode === 'phase' ? nativePhasePersistence : legacyPhasePersistence;
  const seasonId = mode === 'phase' ? id.toLowerCase() : id;
  const phaseId = mode === 'phase' ? requestedPhaseId.toLowerCase() : requestedPhaseId;
  const nativePhase = mode === 'phase' ? await nativePhasePersistence.getById(phaseId) : null;
  const phase = mode === 'phase' ? nativePhase : await legacyPhasePersistence.getById(phaseId);
  if (!phase || phase.season_id !== seasonId) {
    throw new UserFacingError('Phase not found in this league', {
      code: 'PHASE_NOT_FOUND',
      status: 404,
    });
  }
  const assertRosterOpen = (body: unknown) => {
    const request = rosterOverrideOf(body);
    return nativePhase
      ? assertFormatPhaseRosterOpen(seasonId, nativePhase, request, nativePhase.format_stage_key !== null)
      : assertFormatPhaseRosterOpen(seasonId, phase, request);
  };
  return { mode, phase, phaseId, seasonId, persistence, assertRosterOpen };
}

/**
 * Public: no auth required — the phase's participants in seed order, as
 * `PublicParticipantWithSeed` rows (`{ id, name, avatar_url, seed,
 * starting_bracket }`) built field by field: never a spread of the player row.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id, phaseId: requestedPhaseId } = await params;
    // A malformed id names no row: 404 before the query (Postgres would reject the filter with a 500).
    const invalidId = rejectInvalidPathId(id, 'INVALID_SEASON_ID');
    if (invalidId) return invalidId;
    const invalidPhaseId = rejectInvalidPathId(requestedPhaseId, 'INVALID_PHASE_ID');
    if (invalidPhaseId) return invalidPhaseId;
    const { phaseId, persistence } = await loadPhaseRosterScope(id, requestedPhaseId);
    const participants = await persistence.participants(phaseId);
    return NextResponse.json<ApiResult<PublicParticipantWithSeed[]>>({
      success: true,
      data: participants.map(toPublicTournamentParticipant),
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch phase participants');
  }
}

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
    const expire = () => mode === 'phase'
      ? expirePhaseReads(phaseId, seasonId)
      : expireTournamentReads(phaseId, seasonId);

    const rawBody = await request.json();
    // The roster of a format phase that has started is not edited here (409 format_phase_owned) unless the request forces
    // it with a reason; a forced change is audited below once it is made.
    const override = await assertRosterOpen(rawBody);
    const bulkParsed = phaseParticipantBulkSchema.safeParse(rawBody);
    if (bulkParsed.success) {
      const roster = await getSeasonParticipants(seasonId);
      const playerIds = bulkParsed.data.enroll_all_roster
        ? roster.map((p) => p.id)
        : bulkParsed.data.player_ids ?? [];

      await assertSeasonRosterMembers(seasonId, playerIds);

      const existing = await persistence.participants(phaseId);
      const enrolledIds = new Set(existing.map((p) => p.id));
      let added = 0;
      // One insert per player: a later one can fail after the earlier ones committed, so the reads expire and a forced
      // change is audited in a finally, with the players that did get in.
      try {
        for (const playerId of playerIds) {
          if (!enrolledIds.has(playerId)) {
            await persistence.addParticipant(phaseId, playerId);
            enrolledIds.add(playerId);
            added++;
          }
        }
      } finally {
        expire();
        if (override && added > 0) auditRosterOverride(admin, seasonId, phase, override, 'add', { added });
      }

      return NextResponse.json<ApiResult<{ added: number }>>(
        { success: true, data: { added } },
        { status: 201 }
      );
    }

    const singleParsed = seasonParticipantAddSchema.safeParse(rawBody);
    if (!singleParsed.success) {
      const issues = formatZodErrors(singleParsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    await assertSeasonRosterMembers(seasonId, [singleParsed.data.player_id]);
    await persistence.addParticipant(phaseId, singleParsed.data.player_id);
    expire();
    if (override) auditRosterOverride(admin, seasonId, phase, override, 'add', { player_id: singleParsed.data.player_id });
    return NextResponse.json<ApiResult<null>>(
      { success: true, data: null },
      { status: 201 }
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to add phase participant');
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, phaseId: requestedPhaseId } = await params;
    const admin = await requireResourceAdmin('season', id);
    const invalidId = rejectInvalidPathId(id, 'INVALID_SEASON_ID');
    if (invalidId) return invalidId;
    const invalidPhaseId = rejectInvalidPathId(requestedPhaseId, 'INVALID_PHASE_ID');
    if (invalidPhaseId) return invalidPhaseId;
    const { mode, phase, phaseId, seasonId, persistence, assertRosterOpen } = await loadPhaseRosterScope(id, requestedPhaseId);
    assertPhaseEditable(phase, 'participants');

    const rawBody = await request.json();
    // See POST: 409 format_phase_owned for a started format phase, unless forced with a reason.
    const override = await assertRosterOpen(rawBody);
    const parsed = seasonParticipantRemoveSchema.safeParse(rawBody);
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    await persistence.removeParticipant(phaseId, parsed.data.player_id);
    if (mode === 'phase') expirePhaseReads(phaseId, seasonId);
    else expireTournamentReads(phaseId, seasonId);
    if (override) auditRosterOverride(admin, seasonId, phase, override, 'remove', { player_id: parsed.data.player_id });
    return NextResponse.json<ApiResult<null>>({ success: true, data: null });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to remove phase participant');
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, phaseId: requestedPhaseId } = await params;
    const admin = await requireResourceAdmin('season', id);
    const invalidId = rejectInvalidPathId(id, 'INVALID_SEASON_ID');
    if (invalidId) return invalidId;
    const invalidPhaseId = rejectInvalidPathId(requestedPhaseId, 'INVALID_PHASE_ID');
    if (invalidPhaseId) return invalidPhaseId;
    const { mode, phase, phaseId, seasonId, persistence, assertRosterOpen } = await loadPhaseRosterScope(id, requestedPhaseId);
    assertPhaseEditable(phase, 'participants');
    const expire = () => mode === 'phase'
      ? expirePhaseReads(phaseId, seasonId)
      : expireTournamentReads(phaseId, seasonId);

    const rawBody = await request.json();
    // See POST: 409 format_phase_owned for a started format phase, unless forced with a reason.
    const override = await assertRosterOpen(rawBody);
    const parsed = tournamentParticipantSeedsSchema.safeParse(rawBody);
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const body = parsed.data;
    const nonNullSeeds = body.seeds.filter((e) => e.seed !== null).map((e) => e.seed);
    if (new Set(nonNullSeeds).size !== nonNullSeeds.length) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Duplicate seed values are not allowed', code: 'phase_seed_duplicate' },
        { status: 400 }
      );
    }

    const participants = await persistence.participants(phaseId);
    const participantIds = new Set(participants.map((p) => p.id));
    for (const entry of body.seeds) {
      if (!participantIds.has(entry.player_id)) {
        return NextResponse.json<ApiResult<never>>(
          {
            success: false,
            error: `Player ${entry.player_id} is not a participant`,
            code: 'phase_seed_not_participant',
            params: { player_id: entry.player_id },
          },
          { status: 400 }
        );
      }
    }

    try {
      await persistence.updateSeeds(phaseId, body.seeds);
    } catch (err) {
      // A partial write already changed some seeds: expire the cached reads so
      // the admin and viewers see the state that now needs a re-save.
      if (err instanceof SeedUpdatePartialError) expire();
      throw err;
    }
    expire();
    if (override) auditRosterOverride(admin, seasonId, phase, override, 'seeds', { seeded: nonNullSeeds.length });
    return NextResponse.json<ApiResult<null>>({ success: true, data: null });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to update phase seeds');
  }
}
