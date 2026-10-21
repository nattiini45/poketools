// Public GET — season participant list (public shape; roster admins get the admin shape). POST/PATCH/DELETE require resource admin;
// POST and DELETE honour the league-group rules (docs/season.md, "League groups").
import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { seasonParticipantAddSchema, seasonParticipantBulkAddSchema, seasonParticipantRemoveSchema, seasonParticipantUpdateSchema, formatZodErrors } from '@/lib/validation';
import {
  getSeasonParticipants,
  getPublicSeasonParticipants,
  addSeasonParticipant,
  updateParticipantGymType,
  updateParticipantCoreTypes,
} from '@/lib/supabase/queries/seasons';
import { removeLeagueParticipant, toRosterAddError } from '@/lib/supabase/queries/season-groups';
import {
  toAdminSeasonParticipant,
  toPublicSeasonParticipant,
  type AdminSeasonParticipant,
  type PublicSeasonParticipant,
} from '@/lib/players/public-player';
import { canViewAdminRoster } from '@/lib/players/roster-access';
import { expireSeasonReads } from '@/lib/revalidation';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Public: the roster as `PublicSeasonParticipant` rows (`{ id, name, gym_type,
 * avatar_url, core_types }`), read by `getPublicSeasonParticipants`, which
 * never selects the private player columns. A caller the live
 * `requireResourceAdmin` guard confirms as an admin of this season gets
 * `AdminSeasonParticipant` rows instead (adds `is_guest` and
 * `is_test_account` for `LeagueRosterManager`). Neither shape carries identity
 * or moderation columns; both are built field by field.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    // A malformed id names no row: 404 before the query (Postgres would reject the filter with a 500).
    const invalidId = rejectInvalidPathId(id, 'INVALID_SEASON_ID');
    if (invalidId) return invalidId;

    if (await canViewAdminRoster('season', id)) {
      const participants = await getSeasonParticipants(id);
      return NextResponse.json<ApiResult<AdminSeasonParticipant[]>>({
        success: true,
        data: participants.map(toAdminSeasonParticipant),
      });
    }

    const participants = await getPublicSeasonParticipants(id);
    return NextResponse.json<ApiResult<PublicSeasonParticipant[]>>({
      success: true,
      data: participants.map(toPublicSeasonParticipant),
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch participants');
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    await requireResourceAdmin('season', id);
    const invalidId = rejectInvalidPathId(id, 'INVALID_SEASON_ID');
    if (invalidId) return invalidId;
    const rawBody = await request.json();
    const bulkResult = seasonParticipantBulkAddSchema.safeParse(rawBody);
    if (bulkResult.success) {
      for (const playerId of bulkResult.data.player_ids) {
        await addSeasonParticipant(id, playerId);
      }
      expireSeasonReads(id);
      return NextResponse.json<ApiResult<{ added: number }>>(
        { success: true, data: { added: bulkResult.data.player_ids.length } },
        { status: 201 },
      );
    }

    const zodResult = seasonParticipantAddSchema.safeParse(rawBody);

    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    await addSeasonParticipant(id, zodResult.data.player_id);
    expireSeasonReads(id);
    return NextResponse.json<ApiResult<null>>({ success: true, data: null }, { status: 201 });
  } catch (err) {
    // A grouped league that already has rounds refuses new trainers (SEASON_GROUPS_SCHEDULED, 409): they could join
    // no group and would have no fixtures.
    return safeErrorResponse(toRosterAddError(err), 'Failed to add participant');
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    await requireResourceAdmin('season', id);
    const invalidId = rejectInvalidPathId(id, 'INVALID_SEASON_ID');
    if (invalidId) return invalidId;
    const rawBody = await request.json();
    const zodResult = seasonParticipantRemoveSchema.safeParse(rawBody);

    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    // Leaving the league leaves the league group too: the database refuses it once the league has a round
    // (SEASON_GROUPS_SCHEDULED), while the group has a live pool or drafted lines (SEASON_GROUP_LOCKED) and when the
    // group would keep fewer than two trainers (SEASON_GROUP_TOO_SMALL). A trainer not on the roster: nothing to do.
    await removeLeagueParticipant(id, zodResult.data.player_id);
    expireSeasonReads(id);
    return NextResponse.json<ApiResult<null>>({ success: true, data: null });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to remove participant');
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    await requireResourceAdmin('season', id);
    const invalidId = rejectInvalidPathId(id, 'INVALID_SEASON_ID');
    if (invalidId) return invalidId;
    const rawBody = await request.json().catch(() => null);
    const zodResult = seasonParticipantUpdateSchema.safeParse(rawBody);

    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const body = rawBody as Record<string, unknown> | null;
    const hasGymType = body != null && 'gym_type' in body;
    const hasCoreTypes = body != null && 'core_types' in body;

    if (!hasGymType && !hasCoreTypes) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: 'Provide gym_type and/or core_types to update',
          code: 'participant_update_empty',
        },
        { status: 400 },
      );
    }

    const { player_id: playerId } = zodResult.data;

    if (hasGymType) {
      await updateParticipantGymType(id, playerId, zodResult.data.gym_type ?? null);
    }
    if (hasCoreTypes) {
      await updateParticipantCoreTypes(id, playerId, zodResult.data.core_types ?? null);
    }
    expireSeasonReads(id);

    return NextResponse.json<ApiResult<null>>({ success: true, data: null });
  } catch (err) {
    // CoreTypesConflictError / CoreNotInPoolError pass through with their
    // specific triple-identifying messages + codes (UserFacingError).
    return safeErrorResponse(err, 'Failed to update participant');
  }
}
