import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { toPublicMatch, type PublicMatch } from '@/lib/match/public-match';
import { isValidUuid } from '@/lib/utils/uuid';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// Public: no auth required — match detail with player names and games
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    // A malformed id names no match. Answer 404 before the query: Postgres
    // rejects a non-UUID filter, which used to surface as a 500.
    if (!isValidUuid(id)) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Match not found', code: 'INVALID_MATCH_ID' },
        { status: 404 }
      );
    }

    const match = await getMatchById(id);

    if (!match) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Match not found', code: 'match_not_found' },
        { status: 404 }
      );
    }

    // Public response: the allowlisted `PublicMatch` fields only (no admin
    // notes, submitter or confirmation timestamps).
    return NextResponse.json<ApiResult<PublicMatch>>({
      success: true,
      data: toPublicMatch(match),
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch match');
  }
}
