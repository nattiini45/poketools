import { getMatchesByPlayer, getCompletedMatchRecordsBatch } from '@/lib/supabase/queries/matches';
import type { Team, TeamLibraryEntry, PokemonSet, SharedTeamView } from '@/types/team';

/** Redacted pokemon array returned for hidden teams */
export const REDACTED_POKEMON: PokemonSet[] = Array.from({ length: 6 }, () => ({
  name: '',
  species: 'hidden',
  gender: '',
  item: '',
  ability: '',
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  nature: '',
  level: 100,
  moves: [],
}));

export interface VisibilityContext {
  viewerId: string | null;
  isAdmin: boolean;
  /** Tournament ID to scope match-completion check (omit for unscoped) */
  tournamentId?: string;
}

/**
 * Spec Section 7 — canViewTeam contract:
 *   owner → always visible
 *   admin → always visible
 *   opponent has completed match in scope → visible
 *   otherwise → hidden
 */
export async function canViewTeamPokemon(
  team: Team,
  ctx: VisibilityContext
): Promise<boolean> {
  if (ctx.isAdmin) return true;
  if (ctx.viewerId && ctx.viewerId === team.player_id) return true;

  // Check whether the team owner has a completed match in scope
  const scopeId = ctx.tournamentId ?? team.tournament_id ?? undefined;
  const matches = await getMatchesByPlayer(team.player_id, scopeId);
  return matches.some((m) => m.status === 'completed');
}

/**
 * Apply visibility filtering to a list of teams.
 * Hidden teams keep metadata but get redacted pokemon arrays.
 */
export async function filterTeamVisibility<T extends Team>(
  teams: T[],
  ctx: VisibilityContext
): Promise<T[]> {
  return Promise.all(
    teams.map(async (team) => {
      const visible = await canViewTeamPokemon(team, ctx);
      if (visible) return team;
      return { ...team, pokemon: REDACTED_POKEMON };
    })
  );
}

/**
 * Batched visibility filtering — uses a single query to determine which players
 * have completed matches, instead of N individual getMatchesByPlayer calls.
 * Use for list endpoints (e.g. GET /api/teams?tournament_id=...).
 */
export async function filterTeamVisibilityBatch<T extends Team>(
  teams: T[],
  ctx: VisibilityContext
): Promise<T[]> {
  if (teams.length === 0) return [];

  // Admin sees everything, owner sees own — these are synchronous checks
  // We only need the batch query for "has completed match" checks
  const tournamentId = ctx.tournamentId ?? teams[0]?.tournament_id;
  if (!tournamentId) {
    // Fallback to per-team check if no tournament scope
    return filterTeamVisibility(teams, ctx);
  }

  // Single query: get all completed match records for this tournament
  const recordsMap = await getCompletedMatchRecordsBatch([tournamentId]);
  const records = recordsMap.get(tournamentId) ?? [];

  // Build set of player IDs that appear in completed matches
  const playersWithCompletedMatches = new Set<string>();
  for (const record of records) {
    playersWithCompletedMatches.add(record.player_1_id);
    playersWithCompletedMatches.add(record.player_2_id);
  }

  return teams.map((team) => {
    // Admin always sees
    if (ctx.isAdmin) return team;
    // Owner sees own team
    if (ctx.viewerId && ctx.viewerId === team.player_id) return team;
    // Visible if player has a completed match
    if (playersWithCompletedMatches.has(team.player_id)) return team;
    return { ...team, pokemon: REDACTED_POKEMON };
  });
}

/**
 * Convenience wrapper for public (unauthenticated) broadcast endpoints.
 * Returns full pokemon if the team owner has a completed match in the
 * tournament, otherwise returns redacted pokemon.
 */
export async function filterTeamPokemonForBroadcast(
  team: Team | null,
  tournamentId: string
): Promise<PokemonSet[]> {
  if (!team) return [];

  const visible = await canViewTeamPokemon(team, {
    viewerId: null,
    isAdmin: false,
    tournamentId,
  });

  return visible ? team.pokemon : REDACTED_POKEMON;
}

// ── Share link visibility ─────────────────────────────────────────────

/**
 * Teams accessed via share link are always fully visible.
 * The share token itself acts as the authorization — if you have the token,
 * you can see the full team. No auth context needed.
 */
export function filterTeamForShare(team: Team): SharedTeamView {
  return {
    id: team.id,
    pokemon: team.pokemon.filter((p) => p && p.species),
    library_title: team.library_title,
    library_description: team.library_description,
    tournament_id: team.tournament_id,
    created_at: team.created_at,
  };
}

// ── Public library visibility ────────────────────────────────────────

/**
 * Library entries are always fully visible — the pokemon data is public
 * once published. The library listing already filters to only published teams.
 */
export function filterLibraryEntryForDisplay(entry: TeamLibraryEntry): TeamLibraryEntry {
  return entry;
}
