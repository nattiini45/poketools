import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import type { ApiResult } from '@/types/api';
import {
  setTeamShareToken,
  disableTeamShareToken,
  getTeamById,
} from '@/lib/supabase/queries/teams';
import { requireTeamAccess } from '@/lib/api/team-auth';
import { teamShareCreateSchema, teamShareDeleteSchema, formatZodErrors } from '@/lib/validation';

/**
 * POST /api/teams/share
 * Body: { teamId: string }
 * Returns: { success: true, shareToken: string, shareUrl: string }
 *
 * The only response that carries a share token, and only to the team's
 * owner (or an admin): every other team response is a `PublicTeam` (C1).
 */
export async function POST(req: NextRequest) {
  try {
    const player = await requirePlayer();
    const rawBody = await req.json();
    const zodResult = teamShareCreateSchema.safeParse(rawBody);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }
    const { teamId } = zodResult.data;

    const team = await getTeamById(teamId);
    if (!team) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Team not found', code: 'team_not_found' },
        { status: 404 }
      );
    }
    const denied = requireTeamAccess(team, player);
    if (denied) return denied;

    // Resolve the origin BEFORE enabling the link: a misconfiguration must not
    // leave a live share link behind an error response.
    const origin = req.headers.get('origin') || process.env.NEXT_PUBLIC_SITE_URL;
    if (!origin) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: 'Server misconfiguration: site URL not set',
          code: 'team_share_site_url_missing',
        },
        { status: 500 }
      );
    }
    const link = await setTeamShareToken(teamId);
    const shareUrl = `${origin}/teams/shared/${link.share_token}`;

    return NextResponse.json({
      success: true,
      shareToken: link.share_token,
      shareUrl,
    });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to create share link');
  }
}

/**
 * DELETE /api/teams/share
 * Body: { teamId: string }
 */
export async function DELETE(req: NextRequest) {
  try {
    const player = await requirePlayer();
    const rawBody = await req.json();
    const zodResult = teamShareDeleteSchema.safeParse(rawBody);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }
    const { teamId } = zodResult.data;

    const team = await getTeamById(teamId);
    if (!team) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Team not found', code: 'team_not_found' },
        { status: 404 }
      );
    }
    const denied = requireTeamAccess(team, player);
    if (denied) return denied;

    await disableTeamShareToken(teamId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to disable share link');
  }
}
