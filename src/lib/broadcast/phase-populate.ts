import { getPhaseMatchById } from '@/lib/supabase/queries/phase-matches';
import { getPhaseById } from '@/lib/supabase/queries/league-phases';
import { getPhaseRoundById } from '@/lib/supabase/queries/phase-rounds';
import { getPlayerPhaseTeamForMatch } from '@/lib/supabase/queries/phase-teams';
import { getPhaseBattleStatsByMatch } from '@/lib/supabase/queries/phase-games';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { resolveActualTeam } from '@/lib/match/aggregation';
import { decideMatchRosterVisibility } from '@/lib/team/visibility';
import { generationOf } from '@/lib/pkmn/format-id';
import { UserFacingError } from '@/lib/api/user-facing-error';
import type { PhaseCastPopulateResult } from '@/types/phase-cast-session';

export async function loadPhaseCastMatch(
  phaseId: string, matchId: string, actor: { playerId: string; isAdmin: boolean },
): Promise<PhaseCastPopulateResult> {
  const match = await getPhaseMatchById(matchId);
  if (!match || match.phase_id !== phaseId) throw new UserFacingError('Match not found', { code: 'match_not_found', status: 404 });
  const [round, phase, team1, team2, battleStats] = await Promise.all([
    getPhaseRoundById(match.round_id), getPhaseById(phaseId),
    getPlayerPhaseTeamForMatch(match.player_1_id, match), getPlayerPhaseTeamForMatch(match.player_2_id, match),
    getPhaseBattleStatsByMatch(match.id),
  ]);
  if (!phase) throw new UserFacingError('Phase not found', { code: 'INVALID_PHASE_ID', status: 404 });
  const ruleset = await getRulesetById(phase.ruleset_id);
  const viewer = { viewerId: actor.playerId, isAdmin: actor.isAdmin };
  const hasStats = Object.keys(battleStats).length > 0;
  const roster = (team: typeof team1, playerId: string) => {
    if (!team || !decideMatchRosterVisibility(team, viewer, match, phase.team_visibility)) return [];
    return hasStats ? (resolveActualTeam(battleStats, playerId, team.pokemon) ?? team.pokemon) : team.pokemon;
  };
  return {
    match: { id: match.id, phase_id: phase.id, season_id: phase.season_id,
      round_name: round?.name ?? null, best_of: round?.best_of ?? 3, status: match.status },
    player1: { id: match.player_1_id, name: match.player_1_name, avatar_url: match.player_1_avatar_url ?? null },
    player2: { id: match.player_2_id, name: match.player_2_name, avatar_url: match.player_2_avatar_url ?? null },
    player1_team: roster(team1, match.player_1_id), player2_team: roster(team2, match.player_2_id),
    games: match.games, games_played: match.games.length,
    format: ruleset?.base_format ?? null, generation: ruleset ? generationOf(ruleset.base_format) : null,
  };
}
