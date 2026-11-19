import 'server-only';
import { requireOpenPhaseRouteMode } from '@/lib/league-phase/route-mode';
import { resolveIdOnlyMatchRoute } from '@/lib/league-phase/match-route-owner';
import { getPhaseById } from '@/lib/supabase/queries/league-phases';
import { getPhaseMatchById } from '@/lib/supabase/queries/phase-matches';
import { getPhaseRoundById } from '@/lib/supabase/queries/phase-rounds';
import { getPlayerPhaseTeamForMatch } from '@/lib/supabase/queries/phase-teams';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getPlayerTeamForMatch } from '@/lib/supabase/queries/teams';
import { decideMatchRosterVisibility, type TeamViewer } from '@/lib/team/visibility';

export async function loadTrackerMatch(id: string, nativeOnly = false) {
  const mode = await requireOpenPhaseRouteMode();
  if (nativeOnly && mode !== 'phase') return null;
  const matchId = mode === 'phase' ? id.toLowerCase() : id;
  const owner = await resolveIdOnlyMatchRoute(matchId, mode);
  if (owner?.kind === 'phase') {
    const [match, phase] = await Promise.all([getPhaseMatchById(matchId), getPhaseById(owner.phase_id)]);
    if (!match || match.id !== matchId || match.phase_id !== owner.phase_id
      || !phase || phase.id !== owner.phase_id || phase.season_id !== owner.season_id) return null;
    const round = await getPhaseRoundById(match.round_id, phase.id);
    if (!round || round.id !== match.round_id || round.phase_id !== phase.id) return null;
    return { kind: 'phase' as const, match, competition: phase, bestOf: round.best_of };
  }
  if (nativeOnly || owner?.kind !== 'legacy') return null;
  const match = await getMatchById(matchId);
  if (!match) return null;
  const tournament = await getTournamentById(match.tournament_id);
  if (mode === 'phase' && (!tournament || tournament.season_id !== null)) return null;
  return { kind: 'legacy' as const, match, competition: tournament, bestOf: tournament?.best_of_default };
}

export async function readTrackerRosters(read: NonNullable<Awaited<ReturnType<typeof loadTrackerMatch>>>, viewer: TeamViewer) {
  const { match, competition } = read;
  const readTeam = (playerId: string) => read.kind === 'phase'
    ? getPlayerPhaseTeamForMatch(playerId, read.match)
    : getPlayerTeamForMatch(playerId, read.match);
  const [team1, team2] = await Promise.all([readTeam(match.player_1_id), readTeam(match.player_2_id)]);
  const visibility = competition?.team_visibility ?? null;
  return {
    team1: team1 && decideMatchRosterVisibility(team1, viewer, match, visibility) ? team1.pokemon : undefined,
    team2: team2 && decideMatchRosterVisibility(team2, viewer, match, visibility) ? team2.pokemon : undefined,
  };
}
