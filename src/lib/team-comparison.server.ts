import 'server-only';

import { unstable_cache } from 'next/cache';
import { publicTags } from '@/lib/revalidation';
import { getComparisonPicks, getComparisonRegisteredRoster, getComparisonTrackers, getSharedComparisonLeagues } from '@/lib/supabase/queries/team-comparison';
import { comparisonPokemon, mostRecentSharedLeague, superEffectiveStabs, type ComparisonLeague, type TeamComparisonData } from '@/lib/team-comparison';

export function sharedComparisonLeagues(mine: string, theirs: string): Promise<ComparisonLeague[]> {
  return unstable_cache(() => getSharedComparisonLeagues(mine, theirs), ['comparison-leagues-v1', mine, theirs], {
    tags: [publicTags.seasons], revalidate: 30,
  })();
}

async function roster(league: ComparisonLeague, playerId: string, viewerId: string) {
  if (league.format_type === 'evolution_point_buy') {
    const species = await unstable_cache(() => getComparisonTrackers(league.id, playerId), ['comparison-trackers-v1', league.id, playerId], {
      tags: [publicTags.season(league.id)], revalidate: 30,
    })();
    return { hidden: false, pokemon: comparisonPokemon(species) };
  }
  const picks = await unstable_cache(() => getComparisonPicks(league.id, playerId), ['comparison-picks-v1', league.id, playerId], {
    tags: [publicTags.season(league.id)], revalidate: 30,
  })();
  if (picks.length > 0) return { hidden: false, pokemon: comparisonPokemon(picks) };
  const registered = await getComparisonRegisteredRoster(league.id, playerId, viewerId);
  return { hidden: registered.hidden, pokemon: comparisonPokemon(registered.species) };
}

export async function loadTeamComparison(viewerId: string, opponentId: string, requestedLeagueId?: string): Promise<TeamComparisonData> {
  const leagues = await sharedComparisonLeagues(viewerId, opponentId);
  const league = requestedLeagueId ? leagues.find((entry) => entry.id === requestedLeagueId) : mostRecentSharedLeague(leagues);
  if (!league) return { leagues, leagueId: null, mine: { hidden: false, pokemon: [] }, theirs: { hidden: false, pokemon: [] }, myHits: [], theirHits: [] };
  const [mine, theirs] = await Promise.all([roster(league, viewerId, viewerId), roster(league, opponentId, viewerId)]);
  return {
    leagues, leagueId: league.id, mine, theirs,
    myHits: superEffectiveStabs(mine.pokemon, theirs.pokemon),
    theirHits: superEffectiveStabs(theirs.pokemon, mine.pokemon),
  };
}
