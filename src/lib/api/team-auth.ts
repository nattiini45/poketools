import { NextResponse } from 'next/server';
import type { ApiResult } from '@/types/api';
import type { Team } from '@/types/team';
import type { SessionPlayer } from '@/types/auth';

export function requireTeamAccess(team: Team, player: SessionPlayer): NextResponse | null {
  if (team.player_id !== player.playerId && !player.isAdmin) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: 'Not authorized', code: 'forbidden' },
      { status: 403 },
    );
  }
  return null;
}
