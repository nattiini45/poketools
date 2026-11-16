import 'server-only';

import { z } from 'zod';
import { supabase } from '../client';
import { readBoundedPages } from '../read-bounded-pages';
import type { ComparisonLeague } from '@/lib/team-comparison';
import { currentRosterSpecies } from '@/lib/team-comparison';
import { decideTeamPokemonVisibility } from '@/lib/team/visibility';

export async function getSharedComparisonLeagues(mine: string, theirs: string): Promise<ComparisonLeague[]> {
  const { rows: data, truncated } = await readBoundedPages((from, to) => supabase.from('season_participants')
    .select('player_id, seasons!inner(id, name, format_type, start_date, created_at)')
    .in('player_id', [mine, theirs]).order('season_id').order('player_id').range(from, to), { label: 'getSharedComparisonLeagues' });
  if (truncated) throw new Error('Shared comparison league history exceeds the read bound');
  const memberships = new Map<string, { league: ComparisonLeague; players: Set<string> }>();
  for (const row of data) {
    const league = row.seasons;
    const entry = memberships.get(league.id) ?? { league, players: new Set<string>() };
    entry.players.add(row.player_id);
    memberships.set(league.id, entry);
  }
  return [...memberships.values()].filter((entry) => entry.players.has(mine) && entry.players.has(theirs))
    .map(({ league }) => ({ id: league.id, name: league.name, format_type: league.format_type, start_date: league.start_date, created_at: league.created_at }));
}

export async function getComparisonTrackers(seasonId: string, playerId: string): Promise<string[]> {
  const { rows: data, truncated } = await readBoundedPages((from, to) => supabase.from('evolution_tracker').select('current_form')
    .eq('season_id', seasonId).eq('player_id', playerId).order('id').range(from, to), { label: 'getComparisonTrackers' });
  if (truncated) throw new Error('Comparison roster exceeds the read bound');
  return currentRosterSpecies(data);
}

export async function getComparisonPicks(seasonId: string, playerId: string): Promise<string[]> {
  const { rows: data, truncated } = await readBoundedPages((from, to) => supabase.from('draft_picks')
    .select('pokemon_name, draft_pools!inner(season_id)')
    .eq('draft_pools.season_id', seasonId).eq('player_id', playerId)
    .is('voided_at', null).order('pick_number').order('id').range(from, to), { label: 'getComparisonPicks' });
  if (truncated) throw new Error('Comparison pick history exceeds the read bound');
  return data.map((pick) => pick.pokemon_name);
}

const sets = z.array(z.object({ species: z.string() }));

export async function getComparisonRegisteredRoster(seasonId: string, playerId: string, viewerId: string): Promise<{ hidden: boolean; species: string[] }> {
  const { data: stages, error: stageError } = await supabase.from('tournaments').select('id').eq('season_id', seasonId);
  if (stageError) throw stageError;
  const scope = [`season_id.eq.${seasonId}`, ...stages.map((stage) => `tournament_id.eq.${stage.id}`)].join(',');
  const { data, error } = await supabase.from('teams')
    .select('player_id, match_id, library_published_at, pokemon, tournaments(team_visibility), matches!teams_match_id_fkey(status)')
    .eq('player_id', playerId).or(scope).order('created_at', { ascending: false }).order('id').limit(1).maybeSingle();
  if (error) throw error;
  if (!data) return { hidden: false, species: [] };
  const visible = decideTeamPokemonVisibility(data, { viewerId, isAdmin: false }, {
    tournament_visibility: data.tournaments?.team_visibility ?? null,
    match_status: data.matches?.status ?? null,
  });
  return { hidden: !visible, species: visible ? sets.parse(data.pokemon).map((set) => set.species) : [] };
}
