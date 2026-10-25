import { getRoundById } from '@/lib/supabase/queries/rounds';
import { getTournamentWithDetails } from '@/lib/supabase/queries/tournaments';
import { resolvePlayerNames } from '@/lib/supabase/queries/players';
import type { AdminMatchContext } from '@/lib/admin/match-detail';
import type { MatchWithPlayers } from '@/types/match';

/**
 * Where a match sits (league, phase, round, best of, deadline) and who
 * reported it, for the admin match page header. A missing round or tournament
 * throws: the foreign keys guarantee both, so a miss is a data problem the
 * admin error boundary should show, not a blank header.
 */
export async function loadAdminMatchContext(match: MatchWithPlayers): Promise<AdminMatchContext> {
  const [round, tournament, submitterNames] = await Promise.all([
    getRoundById(match.round_id),
    getTournamentWithDetails(match.tournament_id),
    match.submitter_id ? resolvePlayerNames([match.submitter_id]) : Promise.resolve({}),
  ]);

  if (!round) throw new Error(`Round ${match.round_id} not found for match ${match.id}`);
  if (!tournament) throw new Error(`Tournament ${match.tournament_id} not found for match ${match.id}`);

  const submitterName = match.submitter_id
    ? ((submitterNames as Record<string, string>)[match.submitter_id] ?? null)
    : null;

  return {
    league_id: tournament.season_id,
    league_name: tournament.season_name,
    phase_id: tournament.id,
    phase_name: tournament.name,
    round_id: round.id,
    round_name: round.name,
    round_number: round.round_number,
    round_status: round.status,
    best_of: round.best_of,
    round_deadline: round.deadline,
    submitter_name: submitterName,
  };
}
