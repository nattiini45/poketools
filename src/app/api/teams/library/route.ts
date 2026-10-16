import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import type { ApiResult } from '@/types/api';
import { parsePagination } from '@/lib/api/pagination';
import {
  listLibraryTeams,
  publishTeamToLibrary,
  unpublishTeamFromLibrary,
  getTeamById,
} from '@/lib/supabase/queries/teams';
import { filterLibraryEntryForDisplay } from '@/lib/team/visibility';
import { requireTeamAccess } from '@/lib/api/team-auth';
import { teamLibraryPublishSchema, teamLibraryUnpublishSchema, formatZodErrors } from '@/lib/validation';

// Public: no auth required (library listing)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tags = searchParams.get('tags')?.split(',').filter(Boolean) || undefined;
    const { limit, offset, search } = parsePagination(searchParams);

    const result = await listLibraryTeams({ search, tags, limit, offset });
    const data = result.data.map(filterLibraryEntryForDisplay);

    return NextResponse.json({ success: true, data, total: result.total });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to list library teams');
  }
}

/**
 * POST /api/teams/library — publish a team to the library
 * Body: { teamId: string, title?: string, description?: string, tags?: string[] }
 */
export async function POST(req: NextRequest) {
  try {
    const player = await requirePlayer();
    const rawBody = await req.json();
    const zodResult = teamLibraryPublishSchema.safeParse(rawBody);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }
    const { teamId, title, description, tags } = zodResult.data;

    const team = await getTeamById(teamId);
    if (!team) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Team not found', code: 'team_not_found' },
        { status: 404 }
      );
    }
    const denied = requireTeamAccess(team, player);
    if (denied) return denied;

    const updated = await publishTeamToLibrary(teamId, {
      title,
      description,
      tags,
    });

    return NextResponse.json({ success: true, team: updated });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to publish team');
  }
}

/**
 * DELETE /api/teams/library — unpublish a team from the library
 * Body: { teamId: string }
 */
export async function DELETE(req: NextRequest) {
  try {
    const player = await requirePlayer();
    const rawBody = await req.json();
    const zodResult = teamLibraryUnpublishSchema.safeParse(rawBody);
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

    await unpublishTeamFromLibrary(teamId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to unpublish team');
  }
}
