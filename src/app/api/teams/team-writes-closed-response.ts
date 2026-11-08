import { NextResponse } from 'next/server';
import type { ApiErrorCode } from '@/i18n/messages/errors';
import type { ApiResult } from '@/types/api';

/**
 * Why a tournament takes no more team writes from its players, and so which refusal text is true: the tournament itself
 * is completed or archived, or the league (season) it belongs to is. Read by `teamWritesClosed` (./team-writes-closed.ts).
 */
export type TeamWritesClosedReason = 'tournament_completed' | 'tournament_archived' | 'league_closed';

/** The stable code and English text of the 403 for each reason (the clients translate by code, `errors/teams`). */
const REFUSAL: Record<TeamWritesClosedReason, { code: ApiErrorCode; error: string }> = {
  tournament_completed: { code: 'team_submission_closed', error: 'Tournament is completed — team submission is closed' },
  tournament_archived: { code: 'team_submission_tournament_archived', error: 'Tournament is archived — team submission is closed' },
  league_closed: { code: 'team_submission_league_closed', error: 'League is completed or archived — team submission is closed' },
};

/** The 403 a player gets for a team write the closed tournament or league refuses; names the league when the league is the reason. */
export function teamWritesClosedResponse(reason: TeamWritesClosedReason): NextResponse<ApiResult<never>> {
  return NextResponse.json<ApiResult<never>>({ success: false, ...REFUSAL[reason] }, { status: 403 });
}
