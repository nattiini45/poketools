import 'server-only';
import { loadSupplement, packExtensions } from '@/lib/pack-extensions';
import type { HistoricalHonor, HistoricalProfileContribution } from '@/lib/pack-extensions/historical-statistics-types';
import type { HistoricalStatisticsView } from '@/lib/stats/combined-statistics';
import type { CachedPlayerProfile, PlayerProfile, ProfilePokemonStat } from '@/types/profile';

export async function readHistoricalProfile(playerId: string): Promise<{
  data: HistoricalProfileContribution | null;
  history: HistoricalStatisticsView;
}> {
  const provider = packExtensions.historicalProfile;
  if (!provider) return { data: null, history: { state: 'absent', coverage: [] } };
  const result = await loadSupplement('historicalProfile', (ctx) => provider(playerId, ctx));
  if (result.state !== 'ready') return { data: null, history: { state: result.state, coverage: [] } };
  if (result.value.state === 'not_ready') return { data: null, history: { state: 'not_ready', coverage: [] } };
  return { data: result.value.data, history: { state: 'ready', coverage: result.value.data?.coverage ?? [] } };
}

export function combineHistoricalProfile<T extends PlayerProfile | CachedPlayerProfile>(
  profile: T,
  historical: HistoricalProfileContribution | null,
  history: HistoricalStatisticsView,
): T {
  if (!historical || history.state !== 'ready') return { ...profile, history };
  const live = new Map((profile.live_pokemon_counters ?? []).map((row) => [row.pokemon_name, row]));
  const earlier = new Map(historical.pokemon.map((row) => [row.pokemonName, row]));
  const names = new Set([...live.keys(), ...earlier.keys()]);
  const counters: ProfilePokemonStat[] = [...names].map((pokemon_name) => {
    const current = live.get(pokemon_name);
    const previous = earlier.get(pokemon_name);
    const games = previous?.appearances === null ? null : (current?.total_games ?? 0) + (previous?.appearances ?? 0);
    const kos = previous?.kos === null ? null : (current?.total_kos_dealt ?? 0) + (previous?.kos ?? 0);
    const winsKnown = !previous || previous.appearances === 0 || previous.appearances !== null && previous.wins !== null;
    return {
      pokemon_name,
      total_games: games,
      total_kos_dealt: kos,
      total_koed: previous ? null : current?.total_koed ?? null,
      kill_differential: previous ? null : (current?.total_kos_dealt ?? 0) - (current?.total_koed ?? 0),
      win_rate: games !== null && games > 0 && winsKnown
        ? Math.round(((current?.total_wins ?? 0) + (previous?.wins ?? 0)) / games * 100) : null,
    };
  });
  const participations = [...profile.current_participations, ...profile.past_participations];
  const seenHonors = new Set<string>();
  const honors = historical.honors.filter((honor) => {
    const key = JSON.stringify([honor.eventKey, honor.kind, [...honor.playerIds].sort()]);
    if (seenHonors.has(key)) return false;
    seenHonors.add(key);
    if (!honor.preferLive || honor.shared || honor.playerIds.length !== 1 || honor.playerIds[0] !== profile.player.id) return true;
    if (honor.kind === 'champion') {
      return !participations.some((entry) => honor.liveScopeIds.includes(entry.id) && entry.standing?.rank === 1);
    }
    if (honor.kind === 'runner_up') {
      return !profile.trophies.some((entry) => honor.liveScopeIds.includes(entry.id) && entry.rank === 2);
    }
    return true;
  });
  const isIndividualTitle = (honor: HistoricalHonor) => honor.kind === 'champion'
    && !honor.shared && honor.playerIds.length === 1 && honor.playerIds[0] === profile.player.id;
  const past = historical.participations.filter((competition) => !participations.some(
    (entry) => entry.id === competition.id || competition.liveScopeIds?.includes(entry.id),
  ));
  const record = historical.record;
  const matches = profile.headline.total_matches + (record?.played ?? 0);
  const wins = profile.headline.total_wins + (record?.wins ?? 0);
  return {
    ...profile,
    history,
    historical_honors: honors,
    headline: {
      ...profile.headline,
      total_matches: matches,
      total_wins: wins,
      total_losses: profile.headline.total_losses + (record?.losses ?? 0),
      total_draws: (profile.headline.total_draws ?? profile.headline.total_matches - profile.headline.total_wins - profile.headline.total_losses) + (record?.draws ?? 0),
      win_rate: matches > 0 ? Math.round(wins / matches * 100) : 0,
      total_kos_dealt: historical.pokemon.reduce<number | null>(
        (sum, row) => sum === null || row.kos === null ? null : sum + row.kos,
        profile.headline.total_kos_dealt,
      ),
      unique_pokemon_used: new Set([
        ...live.keys(),
        ...historical.pokemon.filter((row) => (row.appearances ?? 0) > 0 || (row.kos ?? 0) > 0).map((row) => row.pokemonName),
      ]).size,
      tournaments_entered: profile.headline.tournaments_entered + past.length,
      tournaments_won: profile.headline.tournaments_won + honors.filter(isIndividualTitle).length,
    },
    most_used_pokemon: counters.filter((row) => row.total_games !== null && row.total_games > 0)
      .sort((a, b) => (b.total_games ?? 0) - (a.total_games ?? 0) || a.pokemon_name.localeCompare(b.pokemon_name)).slice(0, 3),
    best_kill_pokemon: counters.filter((row) => row.total_kos_dealt !== null && row.total_kos_dealt > 0)
      .sort((a, b) => (b.total_kos_dealt ?? 0) - (a.total_kos_dealt ?? 0) || a.pokemon_name.localeCompare(b.pokemon_name)).slice(0, 3)
      .map((row) => ({ pokemon_name: row.pokemon_name, kos_dealt: row.total_kos_dealt!, rank: null, total_ranked: null })),
    past_participations: [...profile.past_participations, ...past.map((competition) => ({
      id: competition.id,
      name: competition.name,
      type: 'tournament' as const,
      status: 'completed' as const,
      bracket_type: null,
      standing: null,
      best_pokemon: null,
      competition,
    }))],
  };
}
