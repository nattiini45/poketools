import 'server-only';

import { getSeasonPlayState } from '@/lib/supabase/queries/format-runtime-reads';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import type { TeamWritesClosedReason } from './team-writes-closed-response';
import { isSeasonClosed } from '@/lib/season/season-state';

/**
 * Whether the tournament (a league phase, or a standalone one) takes no more team writes from its players, and why: it is
 * completed or archived, or its league is completed or archived. A league closed by its admin leaves phases that are
 * still `active`, so the phase status alone is not the gate. `null` means open. Site admins keep their corrections and do
 * not ask. An unknown tournament is not closed (the route answers for it).
 *
 * What a closed tournament still allows its players: deleting their own team that is linked to no match (the route's
 * rule; this function only reports the state). The refusal for each reason is `teamWritesClosedResponse`.
 */
export async function teamWritesClosed(tournamentId: string): Promise<TeamWritesClosedReason | null> {
  const tournament = await getTournamentById(tournamentId);
  if (!tournament) return null;
  if (tournament.status === 'completed') return 'tournament_completed';
  if (tournament.archived) return 'tournament_archived';
  if (!tournament.season_id) return null;
  const season = await getSeasonPlayState(tournament.season_id);
  return season !== null && isSeasonClosed(season) ? 'league_closed' : null;
}
