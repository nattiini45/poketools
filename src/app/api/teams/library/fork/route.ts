import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import type { ApiResult } from '@/types/api';
import { forkTeam, getTeamById } from '@/lib/supabase/queries/teams';
import { checkTeamForkAccess } from '@/lib/team/visibility';
import { toPublicTeam } from '@/lib/team/public-team';
import { teamForkSchema, formatZodErrors } from '@/lib/validation';

/**
 * POST /api/teams/library/fork
 * Body: { sourceTeamId: string, shareToken?: string }
 *
 * Copies a team into the caller's collection as a personal team. The source
 * must be published to the library, or the caller must hold its share token
 * (the same authorization as viewing it through the share link, spec §7).
 */
export async function POST(req: NextRequest) {
  try {
    const player = await requirePlayer();
    const rawBody = await req.json();
    const zodResult = teamForkSchema.safeParse(rawBody);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }
    const { sourceTeamId, shareToken } = zodResult.data;

    const source = await getTeamById(sourceTeamId);
    if (!source) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Source team not found', code: 'team_fork_source_not_found' },
        { status: 404 }
      );
    }

    const access = await checkTeamForkAccess(source, shareToken);
    if (access === 'source_private') {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Source team is not publicly accessible', code: 'team_fork_source_private' },
        { status: 403 }
      );
    }
    if (access === 'share_token_invalid') {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: 'Share link does not match the source team or is disabled',
          code: 'team_fork_share_token_invalid',
        },
        { status: 403 }
      );
    }

    const forked = await forkTeam(source, player.playerId);
    return NextResponse.json({ success: true, team: toPublicTeam(forked) });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to fork team');
  }
}
