import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import type { ApiResult } from '@/types/api';
import { forkTeam, getTeamById } from '@/lib/supabase/queries/teams';
import { teamForkSchema, formatZodErrors } from '@/lib/validation';

/**
 * POST /api/teams/library/fork
 * Body: { sourceTeamId: string, tournamentId?: string }
 * Creates a copy of the team in the current user's collection.
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
    const { sourceTeamId, tournamentId } = zodResult.data;

    const source = await getTeamById(sourceTeamId);
    if (!source) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Source team not found', code: 'team_fork_source_not_found' },
        { status: 404 }
      );
    }
    if (!source.library_published_at && !source.share_enabled_at) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Source team is not publicly accessible', code: 'team_fork_source_private' },
        { status: 403 }
      );
    }

    const forked = await forkTeam(sourceTeamId, player.playerId, tournamentId ?? null);
    return NextResponse.json({ success: true, team: forked });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to fork team');
  }
}
