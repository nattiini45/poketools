import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import type { ApiResult } from '@/types/api';
import { getTeamById } from '@/lib/supabase/queries/teams';
import { filterLibraryEntryForDisplay } from '@/lib/team/visibility';
import type { TeamLibraryEntry } from '@/types/team';

// Public — no auth required (library detail)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const team = await getTeamById(id);

    if (!team || !team.library_published_at) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Team not found or not published', code: 'team_library_entry_not_found' },
        { status: 404 }
      );
    }

    const entry: TeamLibraryEntry = {
      id: team.id,
      player_id: team.player_id,
      pokemon: team.pokemon,
      library_title: team.library_title,
      library_description: team.library_description,
      library_tags: team.library_tags,
      library_published_at: team.library_published_at!,
      forked_from_team_id: team.forked_from_team_id,
      created_at: team.created_at,
      updated_at: team.updated_at,
    };

    const visible = filterLibraryEntryForDisplay(entry);
    return NextResponse.json({ success: true, team: visible });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to fetch library entry');
  }
}
