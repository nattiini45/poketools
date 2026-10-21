import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import type { ApiResult } from '@/types/api';
import { getTeamByShareToken } from '@/lib/supabase/queries/teams';
import { filterTeamForShare } from '@/lib/team/visibility';
import { isValidUuid } from '@/lib/utils/uuid';

/**
 * GET /api/teams/shared/[token]
 * Public: no auth required. The token itself is the authorization; only an
 * enabled link (`share_enabled_at` set) resolves, and the response is the
 * `SharedTeamView` allowlist (never the token).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    // Tokens are UUID v4 (`setTeamShareToken`): anything else cannot match.
    if (!token || typeof token !== 'string' || !isValidUuid(token)) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Invalid token', code: 'team_share_token_invalid' },
        { status: 400 }
      );
    }

    const team = await getTeamByShareToken(token);
    if (!team) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Team not found or link expired', code: 'team_shared_not_found' },
        { status: 404 }
      );
    }

    const visible = filterTeamForShare(team);
    return NextResponse.json({ success: true, team: visible });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to fetch shared team');
  }
}
