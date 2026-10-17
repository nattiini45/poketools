import type { PlayerScopeUsageRow } from '@/lib/supabase/queries/aggregates';
import type { SeasonStatus } from '@/types/season';
import type { TournamentStatus } from '@/types/tournament';

/** One Pokémon of a team used, by its stored English `@pkmn` name. */
export interface TeamUsedPokemon {
  name: string;
  brought: number;
}

/**
 * The Pokémon a player brought in one league or one standalone tournament:
 * every Pokémon of that league or tournament, not one fixed six (a redraft or
 * a swap adds to it). Public data only; it crosses into the client.
 */
export type TeamUsed =
  | { kind: 'league'; id: string; name: string; status: SeasonStatus; pokemon: TeamUsedPokemon[] }
  | { kind: 'tournament'; id: string; name: string; status: TournamentStatus; pokemon: TeamUsedPokemon[] };

export interface TeamsUsedLeague {
  id: string;
  name: string;
  status: SeasonStatus;
  created_at: string;
}

export interface TeamsUsedTournament {
  id: string;
  name: string;
  status: TournamentStatus;
  season_id: string | null;
  created_at: string;
}

/** The league and tournament ids the rows name, so the caller can resolve them. */
export function teamsUsedScopeIds(rows: readonly PlayerScopeUsageRow[]): {
  leagueIds: string[];
  tournamentIds: string[];
} {
  const leagueIds = new Set<string>();
  const tournamentIds = new Set<string>();
  for (const row of rows) {
    (row.scope_type === 'league' ? leagueIds : tournamentIds).add(row.scope_id);
  }
  return { leagueIds: [...leagueIds], tournamentIds: [...tournamentIds] };
}

function sortPokemon(byName: Map<string, number>): TeamUsedPokemon[] {
  return [...byName]
    .map(([name, brought]) => ({ name, brought }))
    .sort((a, b) => b.brought - a.brought || a.name.localeCompare(b.name));
}

function groupByScope(rows: readonly PlayerScopeUsageRow[], scope: PlayerScopeUsageRow['scope_type']) {
  const grouped = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (row.scope_type !== scope) continue;
    const byName = grouped.get(row.scope_id) ?? new Map<string, number>();
    byName.set(row.pokemon_name, (byName.get(row.pokemon_name) ?? 0) + row.total_brought);
    grouped.set(row.scope_id, byName);
  }
  return grouped;
}

/**
 * Group a player's per-scope usage into teams, newest first. A league-stage
 * tournament scope is dropped: its games are already in the league scope. A
 * scope whose league or tournament was not resolved (deleted) is dropped too.
 */
export function buildTeamsUsed(
  rows: readonly PlayerScopeUsageRow[],
  leagues: readonly TeamsUsedLeague[],
  tournaments: readonly TeamsUsedTournament[],
): TeamUsed[] {
  const leagueById = new Map(leagues.map((l) => [l.id, l]));
  const tournamentById = new Map(tournaments.map((t) => [t.id, t]));

  const entries: { createdAt: string; team: TeamUsed }[] = [];
  for (const [id, byName] of groupByScope(rows, 'league')) {
    const league = leagueById.get(id);
    if (!league) continue;
    entries.push({
      createdAt: league.created_at,
      team: { kind: 'league', id, name: league.name, status: league.status, pokemon: sortPokemon(byName) },
    });
  }
  for (const [id, byName] of groupByScope(rows, 'tournament')) {
    const tournament = tournamentById.get(id);
    if (!tournament || tournament.season_id !== null) continue;
    entries.push({
      createdAt: tournament.created_at,
      team: { kind: 'tournament', id, name: tournament.name, status: tournament.status, pokemon: sortPokemon(byName) },
    });
  }

  return entries
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.team.id.localeCompare(b.team.id))
    .map((e) => e.team);
}
