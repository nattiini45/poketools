import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import {
  seasonParticipantAddSchema,
  seasonParticipantRemoveSchema,
  tournamentParticipantSeedsSchema,
  phaseParticipantBulkSchema,
  formatZodErrors,
} from '@/lib/validation';
import { UserFacingError } from '@/lib/api/user-facing-error';
import {
  getTournamentById,
  getParticipants,
  addParticipant,
  removeParticipant,
  updateParticipantSeeds,
} from '@/lib/supabase/queries/tournaments';
import { SeedUpdatePartialError } from '@/lib/tournament/seed-errors';
import { getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { assertPhaseEditable } from '@/lib/tournament/league-phase';
import { toPublicTournamentParticipant } from '@/lib/players/public-player';
import { expireTournamentReads } from '@/lib/revalidation';
import type { ApiResult } from '@/types/api';
import type { PublicParticipantWithSeed } from '@/types/tournament';

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

async function assertRosterMembers(seasonId: string, playerIds: string[]) {
  const roster = await getSeasonParticipants(seasonId);
  const rosterIds = new Set(roster.map((p) => p.id));
  for (const pid of playerIds) {
    if (!rosterIds.has(pid)) {
      throw new UserFacingError(
        'All enrollees must be league roster members',
        { code: 'PHASE_ROSTER_REQUIRED', status: 400 }
      );
    }
  }
}

/**
 * Public — the phase's participants in seed order, as
 * `PublicParticipantWithSeed` rows (`{ id, name, avatar_url, seed,
 * starting_bracket }`) built field by field: never a spread of the player row.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id, phaseId } = await params;
    await assertPhaseInSeason(id, phaseId);
    const participants = await getParticipants(phaseId);
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
    const { id, phaseId } = await params;
    await requireResourceAdmin('season', id);
    const phase = await assertPhaseInSeason(id, phaseId);
    assertPhaseEditable(phase, 'participants');

    const rawBody = await request.json();
    const bulkParsed = phaseParticipantBulkSchema.safeParse(rawBody);
    if (bulkParsed.success) {
      const roster = await getSeasonParticipants(id);
      const playerIds = bulkParsed.data.enroll_all_roster
        ? roster.map((p) => p.id)
        : bulkParsed.data.player_ids ?? [];

      await assertRosterMembers(id, playerIds);

      const existing = await getParticipants(phaseId);
      const enrolledIds = new Set(existing.map((p) => p.id));
      let added = 0;
      for (const playerId of playerIds) {
        if (!enrolledIds.has(playerId)) {
          await addParticipant(phaseId, playerId);
          enrolledIds.add(playerId);
          added++;
        }
      }
      expireTournamentReads(phaseId, id);

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

    await assertRosterMembers(id, [singleParsed.data.player_id]);
    await addParticipant(phaseId, singleParsed.data.player_id);
    expireTournamentReads(phaseId, id);
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
    const { id, phaseId } = await params;
    await requireResourceAdmin('season', id);
    const phase = await assertPhaseInSeason(id, phaseId);
    assertPhaseEditable(phase, 'participants');

    const rawBody = await request.json();
    const parsed = seasonParticipantRemoveSchema.safeParse(rawBody);
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    await removeParticipant(phaseId, parsed.data.player_id);
    expireTournamentReads(phaseId, id);
    return NextResponse.json<ApiResult<null>>({ success: true, data: null });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to remove phase participant');
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, phaseId } = await params;
    await requireResourceAdmin('season', id);
    const phase = await assertPhaseInSeason(id, phaseId);
    assertPhaseEditable(phase, 'participants');

    const rawBody = await request.json();
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

    const participants = await getParticipants(phaseId);
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
      await updateParticipantSeeds(phaseId, body.seeds);
    } catch (err) {
      // A partial write already changed some seeds: expire the cached reads so
      // the admin and viewers see the state that now needs a re-save.
      if (err instanceof SeedUpdatePartialError) expireTournamentReads(phaseId, id);
      throw err;
    }
    expireTournamentReads(phaseId, id);
    return NextResponse.json<ApiResult<null>>({ success: true, data: null });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to update phase seeds');
  }
}
