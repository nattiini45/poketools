import { UserFacingError } from '@/lib/api/user-facing-error';
import { getMatchesByTournament } from '@/lib/supabase/queries/matches';
import type { Round } from '@/types/round';

/**
 * The legacy elimination generator reads results only: a player whose match is unfinished looks like a bye recipient
 * and would advance with their opponent. A round forced to `completed` can still hold such a match, so every route that
 * writes the next round of a legacy elimination bracket refuses here, before its first write.
 */
export async function assertLegacyEliminationRoundSettled(
  tournamentId: string,
  previousRound: Pick<Round, 'id' | 'name'> | undefined,
): Promise<void> {
  if (!previousRound) return;
  const unfinished = (await getMatchesByTournament(tournamentId)).filter(
    (match) => match.round_id === previousRound.id && match.status !== 'completed',
  );
  if (unfinished.length === 0) return;
  throw new UserFacingError(
    `${previousRound.name} still has ${unfinished.length} unfinished match(es), so the next round cannot be built from it. Finish them first.`,
    {
      code: 'rounds_previous_matches_unfinished',
      params: { round: previousRound.name, count: unfinished.length },
      status: 409,
    },
  );
}
