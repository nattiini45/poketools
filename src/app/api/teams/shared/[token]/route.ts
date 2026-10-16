import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import type { ApiResult } from '@/types/api';
import { getTeamByShareToken } from '@/lib/supabase/queries/teams';
import { filterTeamForShare } from '@/lib/team/visibility';

/**
 * GET /api/teams/shared/[token]
 * Public endpoint — no auth required. The token itself is the authorization.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    if (!token || typeof token !== 'string') {
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
