// Public GET — season participant list (public shape; roster admins get the admin shape). POST/PATCH/DELETE require resource admin.
import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { seasonParticipantAddSchema, seasonParticipantBulkAddSchema, seasonParticipantRemoveSchema, seasonParticipantUpdateSchema, formatZodErrors } from '@/lib/validation';
import {
  getSeasonParticipants,
  getPublicSeasonParticipants,
  addSeasonParticipant,
  removeSeasonParticipant,
  updateParticipantGymType,
  updateParticipantCoreTypes,
} from '@/lib/supabase/queries/seasons';
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
    return safeErrorResponse(err, 'Failed to add participant');
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    await requireResourceAdmin('season', id);
    const rawBody = await request.json();
    const zodResult = seasonParticipantRemoveSchema.safeParse(rawBody);

    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    await removeSeasonParticipant(id, zodResult.data.player_id);
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
