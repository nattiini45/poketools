import { NextRequest, NextResponse } from 'next/server';
import { requireCreator } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { castSessionUpdateSchema, formatZodErrors } from '@/lib/validation';
import {
  getCastSessionById,
  updateCastSession,
  deleteCastSession,
} from '@/lib/supabase/queries/cast-sessions';
import type { ApiResult } from '@/types/api';
import type { CastSession, CastSessionUpdate } from '@/types/cast-session';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

type RouteParams = { params: Promise<{ id: string }> };

/** GET /api/cast-sessions/[id] — get a single cast session */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const player = await requireCreator();
    const { id } = await params;
    const invalidId = rejectInvalidPathId(id, 'INVALID_SESSION_ID');
    if (invalidId) return invalidId;

    const session = await getCastSessionById(id);
    if (!session) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Session not found', code: 'cast_session_not_found' },
        { status: 404 }
      );
    }
    if (session.owner_id !== player.playerId && !player.isAdmin) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Not authorized', code: 'cast_session_forbidden' },
        { status: 403 }
      );
    }

    return NextResponse.json<ApiResult<CastSession>>({
      success: true,
      data: session,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch cast session');
  }
}

/** PATCH /api/cast-sessions/[id] — update a cast session (auto-save) */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const player = await requireCreator();
    const { id } = await params;
    const invalidId = rejectInvalidPathId(id, 'INVALID_SESSION_ID');
    if (invalidId) return invalidId;

    const existing = await getCastSessionById(id);
    if (!existing) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Session not found', code: 'cast_session_not_found' },
        { status: 404 }
      );
    }
    if (existing.owner_id !== player.playerId && !player.isAdmin) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Not authorized', code: 'cast_session_forbidden' },
        { status: 403 }
      );
    }

    const rawBody = await request.json();
    const zodResult = castSessionUpdateSchema.safeParse(rawBody);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }
    const body = zodResult.data as CastSessionUpdate;
    const updated = await updateCastSession(id, body);

    return NextResponse.json<ApiResult<CastSession>>({
      success: true,
      data: updated,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to update cast session');
  }
}

/** DELETE /api/cast-sessions/[id] — delete a cast session */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const player = await requireCreator();
    const { id } = await params;
    const invalidId = rejectInvalidPathId(id, 'INVALID_SESSION_ID');
    if (invalidId) return invalidId;

    const existing = await getCastSessionById(id);
    if (!existing) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Session not found', code: 'cast_session_not_found' },
        { status: 404 }
      );
    }
    if (existing.owner_id !== player.playerId && !player.isAdmin) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Not authorized', code: 'cast_session_forbidden' },
        { status: 403 }
      );
    }

    await deleteCastSession(id);

    return NextResponse.json<ApiResult<{ deleted: true }>>({
      success: true,
      data: { deleted: true },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to delete cast session');
  }
}
