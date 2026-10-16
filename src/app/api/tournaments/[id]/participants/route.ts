// Public GET — participant list (public shape; tournament admins get the admin shape). POST/DELETE/PATCH require resource admin.
import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { seasonParticipantAddSchema, seasonParticipantRemoveSchema, tournamentParticipantSeedsSchema, formatZodErrors } from '@/lib/validation';
import {
  getTournamentById,
  getParticipants,
  addParticipant,
  removeParticipant,
  updateParticipantSeeds,
} from '@/lib/supabase/queries/tournaments';
import { SeedUpdatePartialError } from '@/lib/tournament/seed-errors';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import {
  toAdminTournamentParticipant,
  toPublicTournamentParticipant,
  type AdminTournamentParticipant,
  type PublicTournamentParticipant,
} from '@/lib/players/public-player';
import { canViewAdminRoster } from '@/lib/players/roster-access';
import { expireTournamentReads } from '@/lib/revalidation';
import type { ApiResult } from '@/types/api';
import type { BracketType } from '@/types/tournament';

interface RouteParams {
  params: Promise<{ id: string }>;
}

const ELIM_BRACKET_TYPES = new Set<BracketType>(['single_elim', 'double_elim']);

async function assertBracketParticipantMutable(tournamentId: string): Promise<void> {
  const tournament = await getTournamentById(tournamentId);
  if (!tournament || !ELIM_BRACKET_TYPES.has(tournament.bracket_type)) {
    return;
  }

  const rounds = await getRoundsByTournament(tournamentId);
  if (rounds.length > 0) {
    throw new UserFacingError(
      'Bracket seat count is fixed after generation — use substitute or regenerate bracket.',
      { code: 'BRACKET_LOCKED_USE_SUBSTITUTE' }
    );
  }
}

/**
 * Public — list participants in seed order as `PublicTournamentParticipant`
 * rows (`{ id, name, avatar_url, seed, starting_bracket }`), built field by
 * field. A caller the live `requireResourceAdmin` guard confirms as an admin
 * of this tournament (or its season) gets `AdminTournamentParticipant` rows
 * instead, which add `is_guest` for the seeding table's guest badge. Neither
 * shape carries identity or moderation columns.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const asAdmin = await canViewAdminRoster('tournament', id);
    const participants = await getParticipants(id);

    if (asAdmin) {
      return NextResponse.json<ApiResult<AdminTournamentParticipant[]>>({
        success: true,
        data: participants.map(toAdminTournamentParticipant),
      });
    }
    return NextResponse.json<ApiResult<PublicTournamentParticipant[]>>({
      success: true,
      data: participants.map(toPublicTournamentParticipant),
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch participants');
  }
}

// Admin — add participant
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    await requireResourceAdmin('tournament', id);

    const tournament = await getTournamentById(id);
    if (!tournament) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Tournament not found', code: 'tournament_not_found' },
        { status: 404 }
      );
    }
    if (tournament.status !== 'upcoming') {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Cannot add participants after the tournament has started', code: 'tournament_participant_add_locked' },
        { status: 400 }
      );
    }

    const rawBody = await request.json();
    const zodResult = seasonParticipantAddSchema.safeParse(rawBody);

    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    await assertBracketParticipantMutable(id);
    await addParticipant(id, zodResult.data.player_id);
    expireTournamentReads(id, tournament.season_id);
    return NextResponse.json<ApiResult<null>>(
      { success: true, data: null },
      { status: 201 }
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to add participant');
  }
}

// Admin — remove participant
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    await requireResourceAdmin('tournament', id);

    const tournament = await getTournamentById(id);
    if (!tournament) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Tournament not found', code: 'tournament_not_found' },
        { status: 404 }
      );
    }
    if (tournament.status !== 'upcoming') {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Cannot remove participants after the tournament has started', code: 'tournament_participant_remove_locked' },
        { status: 400 }
      );
    }

    const rawBody = await request.json();
    const zodResult = seasonParticipantRemoveSchema.safeParse(rawBody);

    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    await assertBracketParticipantMutable(id);
    await removeParticipant(id, zodResult.data.player_id);
    expireTournamentReads(id, tournament.season_id);
    return NextResponse.json<ApiResult<null>>({ success: true, data: null });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to remove participant');
  }
}

// Admin — update participant seeds
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    await requireResourceAdmin('tournament', id);
    const rawBody = await request.json();
    const zodResult = tournamentParticipantSeedsSchema.safeParse(rawBody);

    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const body = zodResult.data;

    const tournament = await getTournamentById(id);
    if (!tournament) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Tournament not found', code: 'tournament_not_found' },
        { status: 404 }
      );
    }
    if (tournament.status !== 'upcoming') {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Seeding is locked — the tournament has already started', code: 'tournament_seeding_locked' },
        { status: 400 }
      );
    }
    if (ELIM_BRACKET_TYPES.has(tournament.bracket_type)) {
      const rounds = await getRoundsByTournament(id);
      if (rounds.length > 0) {
        throw new UserFacingError(
          'Bracket seat count is fixed after generation — use substitute or regenerate bracket.',
          { code: 'BRACKET_LOCKED_USE_SUBSTITUTE' }
        );
      }
    }

    // Check for duplicate non-null seeds
    const nonNullSeeds = body.seeds.filter((e) => e.seed !== null).map((e) => e.seed);
    if (new Set(nonNullSeeds).size !== nonNullSeeds.length) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Duplicate seed values are not allowed', code: 'tournament_seed_duplicate' },
        { status: 400 }
      );
    }

    // Verify all player_ids are actual participants
    const participants = await getParticipants(id);
    const participantIds = new Set(participants.map((p) => p.id));
    for (const entry of body.seeds) {
      if (!participantIds.has(entry.player_id)) {
        return NextResponse.json<ApiResult<never>>(
          {
            success: false,
            error: `Player ${entry.player_id} is not a participant`,
            code: 'tournament_player_not_participant',
            params: { player: entry.player_id },
          },
          { status: 400 }
        );
      }
    }

    try {
      await updateParticipantSeeds(id, body.seeds);
    } catch (err) {
      // A partial write already changed some seeds: expire the cached reads so
      // the admin and viewers see the state that now needs a re-save.
      if (err instanceof SeedUpdatePartialError) expireTournamentReads(id, tournament.season_id);
      throw err;
    }
    expireTournamentReads(id, tournament.season_id);
    return NextResponse.json<ApiResult<null>>({ success: true, data: null });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to update seeds');
  }
}
