import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { composePlayerProfile } from '@/lib/profile/compose';
import { toPublicProfileView } from '@/lib/profile/redact';
import type { ApiResult } from '@/types/api';
import type { PublicProfileView } from '@/lib/profile/redact';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// Public: no auth required
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    // A malformed id names no row: 404 before the query (Postgres would reject the filter with a 500).
    const invalidId = rejectInvalidPathId(id, 'INVALID_PLAYER_ID');
    if (invalidId) return invalidId;
    const profile = await composePlayerProfile(id);

    if (!profile) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Player not found', code: 'player_not_found' },
        { status: 404 },
      );
    }

    return NextResponse.json<ApiResult<PublicProfileView>>({
      success: true,
      data: toPublicProfileView(profile),
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch player profile');
  }
}
