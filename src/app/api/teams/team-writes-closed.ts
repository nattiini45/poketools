import 'server-only';

import { getSeasonPlayState } from '@/lib/supabase/queries/format-runtime-reads';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';

/**
 * Whether the tournament (a league phase, or a standalone one) takes no more team writes from its players: it is
 * completed or archived, or its league is completed or archived. A league closed by its admin leaves phases that are
 * still `active`, so the phase status alone is not the gate. Site admins keep their corrections and do not ask. An unknown
 * tournament is not closed (the route answers for it).
 */
export async function teamWritesClosed(tournamentId: string): Promise<boolean> {
  const tournament = await getTournamentById(tournamentId);
  if (!tournament) return false;
  if (tournament.status === 'completed' || tournament.archived) return true;
  if (!tournament.season_id) return false;
  const season = await getSeasonPlayState(tournament.season_id);
  return season !== null && (season.status === 'completed' || season.archived);
}
