import 'server-only';
import type { Tables } from '@/types/database';
import type { LeaguePhaseAddress } from '@/lib/league-phase/paths';
import { assertValidUuid } from '@/lib/utils/uuid';
import { readBoundedPages } from '../read-bounded-pages';
import { readAllPages } from '../read-all-pages';
import { supabase } from '../client';

export type ProfilePhase = Pick<Tables<'league_phases'>,
  'id' | 'season_id' | 'name' | 'bracket_type' | 'status' | 'created_at' | 'bracket_reset_enabled' | 'third_place_enabled'>;

export async function getProfilePhases(playerId: string): Promise<ProfilePhase[]> {
  const rows = await readAllPages((from, to) => supabase.from('phase_participants')
    .select(`
      phase:league_phases!phase_participants_phase_id_fkey!inner
        (id, season_id, name, bracket_type, status, created_at, bracket_reset_enabled, third_place_enabled)
    `)
    .eq('player_id', playerId).order('phase_id').range(from, to));
  return rows.map(({ phase }) => phase);
}

export async function getProfilePhaseParticipants(ids: readonly string[]): Promise<Map<string, { id: string; name: string }[]>> {
  const result = new Map<string, { id: string; name: string }[]>(ids.map((id) => [id, []]));
  const unique = [...result.keys()];
  for (let offset = 0; offset < unique.length; offset += 50) {
    const rows = await readAllPages((from, to) => supabase.from('phase_participants')
      .select('phase_id, player_id, player:players!phase_participants_player_id_fkey(name)')
      .in('phase_id', unique.slice(offset, offset + 50)).order('phase_id').order('player_id').range(from, to));
    for (const row of rows) result.get(row.phase_id)?.push({ id: row.player_id, name: row.player.name });
  }
  return result;
}

const MATCH_FIELDS = 'id, created_at, date_played, scheduled_at, status, winner_id, player_1_id, player_2_id';

type MatchFacts = Pick<Tables<'matches'>,
  'id' | 'created_at' | 'date_played' | 'scheduled_at' | 'status' | 'winner_id' | 'player_1_id' | 'player_2_id'> & {
  player_1: { name: string; avatar_url: string | null };
  player_2: { name: string; avatar_url: string | null };
  games: { winner_id: string | null }[];
};

type MatchSourceFields = Omit<MatchFacts, 'player_1' | 'player_2'> & {
  player_1_name: string;
  player_1_avatar_url: string | null;
  player_2_name: string;
  player_2_avatar_url: string | null;
};

export type ProfileMatchSource = MatchSourceFields & (
  { tournament_id: string; tournament_name: string } | (LeaguePhaseAddress & { phase_name: string })
);

function flattenMatchFacts({ player_1, player_2, ...row }: MatchFacts): MatchSourceFields {
  return { ...row, player_1_name: player_1.name, player_2_name: player_2.name,
    player_1_avatar_url: player_1.avatar_url, player_2_avatar_url: player_2.avatar_url };
}

export async function getMixedProfileMatches(playerId: string): Promise<ProfileMatchSource[]> {
  assertValidUuid(playerId, 'playerId');
  const playerFilter = `player_1_id.eq.${playerId},player_2_id.eq.${playerId}`;
  const [standalone, phases] = await Promise.all([
    supabase.from('matches')
      .select(`
        ${MATCH_FIELDS}, tournament_id, owner:tournaments!matches_tournament_id_fkey!inner(name, season_id),
        player_1:players!matches_player_1_id_fkey(name, avatar_url),
        player_2:players!matches_player_2_id_fkey(name, avatar_url), games(winner_id)
      `)
      .or(playerFilter).is('owner.season_id', null).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(500),
    supabase.from('phase_matches')
      .select(`
        ${MATCH_FIELDS}, phase_id, phase:league_phases!phase_matches_phase_id_fkey!inner(name, season_id),
        player_1:players!phase_matches_player_1_id_fkey(name, avatar_url),
        player_2:players!phase_matches_player_2_id_fkey(name, avatar_url), games:phase_games!phase_games_match_id_fkey(winner_id)
      `)
      .or(playerFilter).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(500),
  ]);
  if (standalone.error) throw standalone.error;
  if (phases.error) throw phases.error;
  const rows: ProfileMatchSource[] = [
    ...standalone.data.map(({ owner, tournament_id, ...row }) => ({ ...flattenMatchFacts(row), tournament_id, tournament_name: owner.name })),
    ...phases.data.map(({ phase, phase_id, ...row }) => ({ ...flattenMatchFacts(row), phase_id, season_id: phase.season_id, phase_name: phase.name })),
  ];
  return rows.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)).slice(0, 500);
}

export type ProfilePokemonResult = { pokemon_name: string; kos_dealt: number } & ({ tournament_id: string } | { phase_id: string });

export async function getMixedProfileBattleStats(playerId: string): Promise<ProfilePokemonResult[]> {
  const [standalone, phases] = await Promise.all([
    readBoundedPages((from, to) => supabase.from('battle_stats')
      .select('pokemon_name, kos_dealt, games!inner(matches!inner(tournament_id, tournaments!matches_tournament_id_fkey!inner(season_id)))')
      .eq('player_id', playerId).is('games.matches.tournaments.season_id', null)
      .order('created_at').order('id').range(from, to), { label: 'getStandaloneProfileBattleStats' }),
    readBoundedPages((from, to) => supabase.from('phase_battle_stats')
      .select('pokemon_name, kos_dealt, phase_games!inner(phase_matches!inner(phase_id))')
      .eq('player_id', playerId).order('created_at').order('id').range(from, to), { label: 'getPhaseProfileBattleStats' }),
  ]);
  return [
    ...standalone.rows.map(({ games, ...stat }) => ({ ...stat, tournament_id: games.matches.tournament_id })),
    ...phases.rows.map(({ phase_games, ...stat }) => ({ ...stat, phase_id: phase_games.phase_matches.phase_id })),
  ];
}
