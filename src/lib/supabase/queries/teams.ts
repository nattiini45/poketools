import { supabase } from '../client';
import type { Tables, Json } from '@/types/database';
import type { Team, TeamFormData, TeamWithContext, TeamLibraryEntry, TeamLibraryListParams, PokemonSet, TeamImportSource } from '@/types/team';

type TeamRow = Tables<'teams'>;

function escapeIlikePattern(input: string): string {
  return input.replace(/[%_()\\]/g, '\\$&');
}

function toTeam(row: TeamRow): Team {
  return {
    id: row.id,
    player_id: row.player_id,
    // Fallback for rows read before the add_team_name migration is applied
    name: row.name ?? '',
    tournament_id: row.tournament_id,
    season_id: row.season_id,
    match_id: row.match_id,
    pokemon: row.pokemon as unknown as PokemonSet[],
    import_source: row.import_source,
    locked: row.locked,
    is_draft_team: row.is_draft_team,
    draft_pool_id: row.draft_pool_id,
    share_token: row.share_token,
    share_enabled_at: row.share_enabled_at,
    library_published_at: row.library_published_at,
    library_title: row.library_title,
    library_description: row.library_description,
    library_tags: row.library_tags,
    forked_from_team_id: row.forked_from_team_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** List all teams for a tournament */
export async function listTeamsByTournament(tournamentId: string): Promise<Team[]> {
  const { data, error } = await supabase
    .from('teams')
    .select('*')
    .eq('tournament_id', tournamentId)
    .order('created_at');

  if (error) throw error;
  return data.map(toTeam);
}

/** List all teams across multiple tournaments in a single query */
export async function listTeamsByTournamentIds(tournamentIds: string[]): Promise<Team[]> {
  if (tournamentIds.length === 0) return [];

  const { data, error } = await supabase
    .from('teams')
    .select('*')
    .in('tournament_id', tournamentIds)
    .order('created_at');

  if (error) throw error;
  return data.map(toTeam);
}

/** List all teams belonging to a player */
export async function listTeamsByPlayer(playerId: string): Promise<Team[]> {
  const { data, error } = await supabase
    .from('teams')
    .select('*')
    .eq('player_id', playerId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data.map(toTeam);
}

/** Get a team by ID */
export async function getTeamById(id: string): Promise<Team | null> {
  const { data, error } = await supabase
    .from('teams')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data ? toTeam(data) : null;
}

/** Get a player's team for a specific tournament */
export async function getPlayerTeamForTournament(
  playerId: string,
  tournamentId: string
): Promise<Team | null> {
  const { data, error } = await supabase
    .from('teams')
    .select('*')
    .eq('player_id', playerId)
    .eq('tournament_id', tournamentId)
    .maybeSingle();

  if (error) throw error;
  return data ? toTeam(data) : null;
}

/** List all teams belonging to a player, with tournament name for context */
export async function listTeamsByPlayerWithContext(
  playerId: string,
  options?: { limit?: number; offset?: number }
): Promise<{ data: TeamWithContext[]; total: number }> {
  const limit = Math.min(options?.limit ?? 50, 200);
  const offset = options?.offset ?? 0;

  const { data, error, count } = await supabase
    .from('teams')
    .select('*, tournaments(name)', { count: 'exact' })
    .eq('player_id', playerId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw error;
  return {
    data: data.map((row) => ({
      ...toTeam(row as unknown as TeamRow),
      tournament_name: (row as Record<string, unknown>).tournaments
        ? ((row as Record<string, unknown>).tournaments as { name: string }).name
        : null,
    })),
    total: count ?? 0,
  };
}

/** List all teams belonging to a season (league) */
export async function listTeamsBySeason(seasonId: string): Promise<Team[]> {
  const { data, error } = await supabase
    .from('teams')
    .select('*')
    .eq('season_id', seasonId)
    .order('created_at');

  if (error) throw error;
  return data.map(toTeam);
}

/**
 * The slice of a team the route worlds' ace derivation reads: which player,
 * how recent, and the lead set's species.
 *
 * `lead_species` is `null` when the team has no first set (an empty team),
 * and the set's species otherwise (`''` for a lead set with a blank species,
 * which still makes the team that player's newest team).
 */
export interface TeamLead {
  id: string;
  player_id: string;
  updated_at: string;
  lead_species: string | null;
}

/**
 * Every season team's lead species, read with a JSON path
 * (`pokemon->0->>species`) so the full sets (moves, EVs, items, …) never
 * leave the database. Same rows and order as `listTeamsBySeason`.
 */
export async function listTeamLeadsBySeason(seasonId: string): Promise<TeamLead[]> {
  const { data, error } = await supabase
    .from('teams')
    .select('id, player_id, updated_at, lead_species:pokemon->0->>species')
    .eq('season_id', seasonId)
    .order('created_at');

  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    player_id: row.player_id,
    updated_at: row.updated_at,
    lead_species: typeof row.lead_species === 'string' ? row.lead_species : null,
  }));
}

/** Create a new team */
export async function createTeam(
  playerId: string,
  input: TeamFormData
): Promise<Team> {
  const { data, error } = await supabase
    .from('teams')
    .insert({
      player_id: playerId,
      tournament_id: input.tournament_id ?? null,
      season_id: input.season_id ?? null,
      pokemon: input.pokemon as unknown as Json,
      import_source: input.import_source,
      // Only send the column when a name was given (pre-migration safety)
      ...(input.name !== undefined ? { name: input.name } : {}),
    })
    .select()
    .single();

  if (error) throw error;
  return toTeam(data);
}

/** Update a team's Pokémon (only if not locked) */
export async function updateTeamPokemon(
  id: string,
  pokemon: PokemonSet[],
  importSource: Team['import_source'],
  name?: string
): Promise<Team> {
  // First verify the team is not locked
  const existing = await getTeamById(id);
  if (!existing) throw new Error('Team not found');
  if (existing.locked) throw new Error('Team is locked and cannot be edited');

  const { data, error } = await supabase
    .from('teams')
    .update({
      pokemon: pokemon as unknown as Json,
      import_source: importSource,
      // Only send the column when a name was given (pre-migration safety)
      ...(name !== undefined ? { name } : {}),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return toTeam(data);
}

/** Lock a team (typically when tournament starts) */
export async function lockTeam(id: string): Promise<Team> {
  const { data, error } = await supabase
    .from('teams')
    .update({ locked: true })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return toTeam(data);
}

/** Lock all teams for a tournament */
export async function lockTeamsByTournament(tournamentId: string): Promise<void> {
  const { error } = await supabase
    .from('teams')
    .update({ locked: true })
    .eq('tournament_id', tournamentId);

  if (error) throw error;
}

/** Delete a team (only if not locked) */
export async function deleteTeam(id: string): Promise<void> {
  const existing = await getTeamById(id);
  if (!existing) throw new Error('Team not found');
  if (existing.locked) throw new Error('Team is locked and cannot be deleted');

  const { error } = await supabase
    .from('teams')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

/**
 * Upsert a team linked to a specific match (used by match-prep sync).
 * - If a team already exists for (player_id, match_id) and is unlocked, updates it.
 * - If it exists but is locked, returns null (skip silently).
 * - If it doesn't exist, creates a new row.
 */
export async function upsertTeamForMatch(
  playerId: string,
  matchId: string,
  tournamentId: string,
  pokemon: PokemonSet[],
  importSource: TeamImportSource
): Promise<Team | null> {
  // Check for existing team for this player + match
  const { data: existing } = await supabase
    .from('teams')
    .select('*')
    .eq('player_id', playerId)
    .eq('match_id', matchId)
    .maybeSingle();

  if (existing) {
    if (existing.locked) return null;

    const { data, error } = await supabase
      .from('teams')
      .update({
        pokemon: pokemon as unknown as Json,
        import_source: importSource,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select()
      .single();

    if (error) throw error;
    return toTeam(data);
  }

  const { data, error } = await supabase
    .from('teams')
    .insert({
      player_id: playerId,
      match_id: matchId,
      tournament_id: tournamentId,
      pokemon: pokemon as unknown as Json,
      import_source: importSource,
    })
    .select()
    .single();

  if (error) throw error;
  return toTeam(data);
}

/**
 * Null the `match_id` pointer on every team snapshot linked to a match
 * (match-scoped), WITHOUT deleting the team rows. `teams` is a shared
 * teambuilder entity (it also carries tournament_id/season_id/draft_pool_id),
 * so the row is preserved on match undo and only the stale pointer is
 * cleared — mirroring the hard-delete FK `ON DELETE SET NULL` behavior.
 * Returns the count of rows whose pointer was cleared so the cleanup can
 * surface it in its summary.
 */
export async function clearTeamsMatchPointer(matchId: string): Promise<number> {
  const { count, error } = await supabase
    .from('teams')
    .update({ match_id: null }, { count: 'exact' })
    .eq('match_id', matchId);

  if (error) throw error;
  return count ?? 0;
}

/**
 * Get item usage for a Pokémon by scanning teams from completed matches.
 * Targeted server-side read — aggregates don't store item data (CLAUDE.md rule #4 exception).
 */
export async function getItemUsageForPokemon(
  pokemonName: string,
  scopeType: 'tournament' | 'league' | 'all_time',
  scopeId: string | null,
  playerId?: string
): Promise<{ name: string; count: number; usage_percent: number }[]> {
  let query = supabase
    .from('teams')
    .select('pokemon, matches!teams_match_id_fkey(status, tournament_id)')
    .not('match_id', 'is', null);

  if (scopeType === 'tournament' && scopeId) {
    query = query.eq('tournament_id', scopeId);
  } else if (scopeType === 'league' && scopeId) {
    query = query.eq('season_id', scopeId);
  }

  if (playerId) {
    query = query.eq('player_id', playerId);
  }

  const { data, error } = await query;
  if (error) throw error;
  if (!data || data.length === 0) return [];

  const itemCounts: Record<string, number> = {};
  let totalSets = 0;

  for (const row of data) {
    const match = row.matches as unknown as { status: string; tournament_id: string } | null;
    if (!match || match.status !== 'completed') continue;

    const pokemon = row.pokemon as unknown as PokemonSet[];
    if (!Array.isArray(pokemon)) continue;

    for (const set of pokemon) {
      if (set.species === pokemonName && set.item) {
        itemCounts[set.item] = (itemCounts[set.item] ?? 0) + 1;
        totalSets++;
      }
    }
  }

  return Object.entries(itemCounts)
    .map(([name, count]) => ({
      name,
      count,
      usage_percent: totalSets > 0 ? (count / totalSets) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count);
}

// ── Share link queries ───────────────────────────────────────────────

/** Get a team by its share token (public, no auth) */
export async function getTeamByShareToken(shareToken: string): Promise<Team | null> {
  const { data, error } = await supabase
    .from('teams')
    .select('*')
    .eq('share_token', shareToken)
    .not('share_enabled_at', 'is', null)
    .maybeSingle();

  if (error) throw error;
  return data ? toTeam(data) : null;
}

/** Enable or regenerate a share link for a team */
export async function setTeamShareToken(
  teamId: string
): Promise<Team> {
  const { data, error } = await supabase
    .from('teams')
    .update({
      share_token: crypto.randomUUID(),
      share_enabled_at: new Date().toISOString(),
    })
    .eq('id', teamId)
    .select()
    .single();

  if (error) throw error;
  return toTeam(data);
}

/** Disable a share link for a team */
export async function disableTeamShareToken(
  teamId: string
): Promise<Team> {
  const { data, error } = await supabase
    .from('teams')
    .update({
      share_token: null,
      share_enabled_at: null,
    })
    .eq('id', teamId)
    .select()
    .single();

  if (error) throw error;
  return toTeam(data);
}

// ── Library queries ──────────────────────────────────────────────────

/** List published teams in the public library with optional filtering */
export async function listLibraryTeams(
  params?: TeamLibraryListParams
): Promise<{ data: TeamLibraryEntry[]; total: number }> {
  const limit = Math.min(params?.limit ?? 50, 200);
  const offset = params?.offset ?? 0;

  let query = supabase
    .from('teams')
    .select('id, player_id, pokemon, library_title, library_description, library_tags, library_published_at, forked_from_team_id, created_at, updated_at', { count: 'exact' })
    .not('library_published_at', 'is', null)
    .order('library_published_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (params?.tags && params.tags.length > 0) {
    query = query.overlaps('library_tags', params.tags);
  }

  if (params?.search) {
    const escaped = escapeIlikePattern(params.search);
    query = query.or(`library_title.ilike.%${escaped}%,library_description.ilike.%${escaped}%`);
  }

  const { data, error, count } = await query;
  if (error) throw error;

  return {
    data: (data ?? []).map((row) => ({
      id: row.id,
      player_id: row.player_id,
      pokemon: row.pokemon as unknown as PokemonSet[],
      library_title: row.library_title,
      library_description: row.library_description,
      library_tags: row.library_tags,
      library_published_at: row.library_published_at!,
      forked_from_team_id: row.forked_from_team_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
    })),
    total: count ?? 0,
  };
}

/** Publish a team to the public library */
export async function publishTeamToLibrary(
  teamId: string,
  metadata: { title?: string; description?: string; tags?: string[] }
): Promise<Team> {
  const { data, error } = await supabase
    .from('teams')
    .update({
      library_published_at: new Date().toISOString(),
      library_title: metadata.title ?? null,
      library_description: metadata.description ?? null,
      library_tags: metadata.tags ?? [],
    })
    .eq('id', teamId)
    .select()
    .single();

  if (error) throw error;
  return toTeam(data);
}

/** Unpublish a team from the public library */
export async function unpublishTeamFromLibrary(
  teamId: string
): Promise<Team> {
  const { data, error } = await supabase
    .from('teams')
    .update({
      library_published_at: null,
      library_title: null,
      library_description: null,
      library_tags: null,
    })
    .eq('id', teamId)
    .select()
    .single();

  if (error) throw error;
  return toTeam(data);
}

/** Fork a team from the library (or any share-enabled team) into the current user's collection */
export async function forkTeam(
  sourceTeamId: string,
  targetPlayerId: string,
  tournamentId?: string | null,
  seasonId?: string | null
): Promise<Team> {
  const source = await getTeamById(sourceTeamId);
  if (!source) throw new Error('Source team not found');

  // Source must be either library-published or share-enabled
  const isAccessible = source.library_published_at || source.share_enabled_at;
  if (!isAccessible) throw new Error('Source team is not publicly accessible');

  const { data, error } = await supabase
    .from('teams')
    .insert({
      player_id: targetPlayerId,
      tournament_id: tournamentId ?? null,
      season_id: seasonId ?? null,
      pokemon: source.pokemon as unknown as Json,
      import_source: 'manual',
      forked_from_team_id: sourceTeamId,
    })
    .select()
    .single();

  if (error) throw error;
  return toTeam(data);
}
