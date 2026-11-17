import { getPhaseTeamByShareToken, getPhaseTeamVisibilityFacts } from '@/lib/supabase/queries/phase-teams';
import { getTeamByShareToken } from '@/lib/supabase/queries/teams';
import { decideTeamPokemonVisibility, redactedPokemon, type TeamViewer } from './visibility';
import { toPublicPhaseTeam, type PublicPhaseTeam } from './phase-public-team';
import type { PhaseTeam } from '@/types/phase-team';
import type { Team } from '@/types/team';

export async function filterPhaseTeamVisibility(teams: readonly PhaseTeam[], viewer: TeamViewer): Promise<PublicPhaseTeam[]> {
  const undecided = teams.filter((team) => !viewer.isAdmin && team.player_id !== viewer.viewerId && !team.library_published_at);
  const facts = await getPhaseTeamVisibilityFacts(undecided.map((team) => team.id));
  return teams.map((team) => {
    const result = toPublicPhaseTeam(team);
    if (!decideTeamPokemonVisibility(team, viewer, facts.get(team.id))) result.pokemon = redactedPokemon();
    return result;
  });
}

export type SharedTeamResource = { kind: 'phase'; team: PhaseTeam } | { kind: 'team'; team: Team };

export async function resolveNativeTeamShare(token: string): Promise<SharedTeamResource | null> {
  const [phase, team] = await Promise.all([getPhaseTeamByShareToken(token), getTeamByShareToken(token)]);
  if (phase && team) throw new Error('Share token exists in both team stores');
  return phase ? { kind: 'phase', team: phase } : team ? { kind: 'team', team } : null;
}

export async function checkPhaseTeamForkAccess(source: PhaseTeam, token?: string): Promise<'allowed' | 'source_private' | 'share_token_invalid'> {
  if (source.library_published_at) return 'allowed';
  if (!token) return 'source_private';
  const shared = await resolveNativeTeamShare(token);
  return shared?.kind === 'phase' && shared.team.id === source.id ? 'allowed' : 'share_token_invalid';
}
