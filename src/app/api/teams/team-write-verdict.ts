import 'server-only';

import { NextResponse } from 'next/server';
import { getTeamVisibilityFacts } from '@/lib/supabase/queries/teams';
import { isCompletedMatchLocked } from '@/lib/team/completed-match-lock';
import { resolveTeamWriteVerdict, type TeamWriteOp } from '@/lib/team/team-roster-state';
import type { ApiResult } from '@/types/api';
import type { SessionPlayer } from '@/types/auth';
import type { Team } from '@/types/team';
import { teamWritesClosed } from './team-writes-closed';
import { teamWritesClosedResponse } from './team-writes-closed-response';

/**
 * The refusal of an edit or delete of `team` by its owner or a site admin, or null when the write may go ahead: the
 * machine `team.roster` (src/lib/team/team-roster-state.ts) decides from the manual lock, the closure of the team's
 * tournament or league and its linked match, reading only the facts that can still change the answer. The caller has
 * already refused anyone who is neither the owner nor an admin.
 *
 * - manual lock: 409 `team_locked`;
 * - closed tournament or league: 403 with the closure's code (`teamWritesClosedResponse`);
 * - linked to a completed match: 409 `team_match_completed`.
 */
export async function teamWriteRefusal(
  team: Team,
  op: TeamWriteOp,
  player: SessionPlayer
): Promise<NextResponse<ApiResult<never>> | null> {
  const verdict = await resolveTeamWriteVerdict({
    op,
    actor: player.isAdmin ? 'admin' : 'owner',
    locked: team.locked,
    linkedToMatch: !!team.match_id,
    loadClosure: async () => (team.tournament_id ? teamWritesClosed(team.tournament_id) : null),
    loadMatchCompleted: async () => {
      const facts = await getTeamVisibilityFacts([team.id]);
      return isCompletedMatchLocked(facts.get(team.id)?.match_status);
    },
  });
  if (verdict.ok) return null;
  if (verdict.closure) return teamWritesClosedResponse(verdict.closure);
  if (verdict.state === 'match_completed') {
    return NextResponse.json<ApiResult<never>>(
      {
        success: false,
        error: 'This team belongs to a completed match and can no longer be changed',
        code: 'team_match_completed',
      },
      { status: 409 }
    );
  }
  return NextResponse.json<ApiResult<never>>(
    { success: false, error: 'Team is locked', code: 'team_locked' },
    { status: 409 }
  );
}
