import { supabase } from '../client';
import { ilikeAnyOf, postgrestQuoted } from '../postgrest-filter';
import { readBoundedPages } from '../read-bounded-pages';
import type { Tables, Json } from '@/types/database';
import type { AggregateScope } from '@/types/game';
import type { MatchStatus } from '@/types/match';
import type { TeamVisibility } from '@/types/tournament';
import { isCompletedMatchLocked, throwTeamWriteError } from '@/lib/team/completed-match-lock';
import type {
  Team,
  TeamFormData,
  TeamWithContext,
  TeamLibraryEntry,
  TeamLibraryListParams,
  TeamShareLink,
  PokemonSet,
  TeamImportSource,
} from '@/types/team';

/** The share-link columns: only the owner's share route writes or returns them. */
type TeamShareColumn = 'share_token' | 'share_enabled_at';

type TeamRow = Omit<Tables<'teams'>, TeamShareColumn>;

/**
 * Every `teams` column a team read selects: all of them except the share-link
 * columns (code review C1). Never `select('*')` or a bare `.select()` on
 * `teams` in this module: the share token would ride along into every `Team`
 * and from there into list and detail responses. Every team read selects
 * explicit columns without a share column (the query tests pin this). The one
 * exception is `setTeamShareToken`, which selects the share columns and
 * returns them only as a `TeamShareLink` to the owner's share route.
 */
export const TEAM_COLUMNS =
  'id, player_id, name, tournament_id, season_id, match_id, pokemon, import_source, locked, is_draft_team, draft_pool_id, library_published_at, library_title, library_description, library_tags, forked_from_team_id, created_at, updated_at' as const;

const TEAM_COLUMNS_WITH_TOURNAMENT_NAME = `${TEAM_COLUMNS}, tournaments(name)` as const;

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
    .select(TEAM_COLUMNS)
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
    .select(TEAM_COLUMNS)
    .in('tournament_id', tournamentIds)
    .order('created_at');

  if (error) throw error;
  return data.map(toTeam);
}

/** List all teams belonging to a player */
export async function listTeamsByPlayer(playerId: string): Promise<Team[]> {
  const { data, error } = await supabase
    .from('teams')
    .select(TEAM_COLUMNS)
    .eq('player_id', playerId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data.map(toTeam);
}

/** Get a team by ID */
export async function getTeamById(id: string): Promise<Team | null> {
  const { data, error } = await supabase
    .from('teams')
    .select(TEAM_COLUMNS)
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data ? toTeam(data) : null;
}

/**
 * A player's PLANNED team for a tournament: the row with no `match_id`.
 *
 * A player can hold more rows in one tournament: match-prep adds one row per
 * match (`upsertTeamForMatch`, `teams.match_id`) next to the planned row.
 * Those are not the planned team, so they are left out here; match-scoped
 * callers use `getPlayerTeamForMatch`. Two planned rows for one player and
 * tournament are a data error and throw (PostgREST PGRST116).
 */
export async function getPlayerTeamForTournament(
  playerId: string,
  tournamentId: string
): Promise<Team | null> {
  const { data, error } = await supabase
    .from('teams')
    .select(TEAM_COLUMNS)
    .eq('player_id', playerId)
    .eq('tournament_id', tournamentId)
    .is('match_id', null)
    .maybeSingle();

  if (error) throw error;
  return data ? toTeam(data) : null;
}

/** The match a match-scoped team read is for. */
export interface TeamMatchRef {
  id: string;
  tournament_id: string;
}

/**
 * The team a player brings to `match`: the row linked to that match
 * (`teams.match_id`, written by match-prep) when there is one, else the
 * player's planned row for the match's tournament (no `match_id`). Rows
 * linked to OTHER matches are never returned.
 *
 * Two rows for the same slot (two linked to this match, or two planned rows)
 * are a data error and throw, like `maybeSingle` would.
 */
export async function getPlayerTeamForMatch(
  playerId: string,
  match: TeamMatchRef
): Promise<Team | null> {
  const { data, error } = await supabase
    .from('teams')
    .select(TEAM_COLUMNS)
    .eq('player_id', playerId)
    .eq('tournament_id', match.tournament_id)
    // The match id goes into a logic tree, so it is quoted (L1).
    .or(`match_id.eq.${postgrestQuoted(match.id)},match_id.is.null`)
    .order('created_at', { ascending: false });

  if (error) throw error;
  const rows = data ?? [];
  const linked = rows.filter((row) => row.match_id === match.id);
  const planned = rows.filter((row) => row.match_id === null);
  if (linked.length > 1 || (linked.length === 0 && planned.length > 1)) {
    throw new Error(
      `getPlayerTeamForMatch: player ${playerId} has ${linked.length > 1 ? linked.length : planned.length} ${linked.length > 1 ? 'rows linked to match' : 'planned rows for the tournament of match'} ${match.id}`
    );
  }
  const row = linked[0] ?? planned[0];
  return row ? toTeam(row) : null;
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
    .select(TEAM_COLUMNS_WITH_TOURNAMENT_NAME, { count: 'exact' })
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
    .select(TEAM_COLUMNS)
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

/** A team lead with the spec §7 facts of its own row (linked match status, tournament setting). */
export interface TeamLeadWithFacts extends TeamLead {
  facts: TeamVisibilityFacts;
}

/** The lead slice plus the facts, embedded in the same read (one request per page). */
const TEAM_LEAD_WITH_FACTS_SELECT =
  'id, player_id, updated_at, lead_species:pokemon->0->>species, match:matches!teams_match_id_fkey(status), tournament:tournaments!teams_tournament_id_fkey(team_visibility)' as const;

/** PostgREST `max_rows` (supabase/config.toml): a page this wide or shorter ends the read when short. */
const TEAM_LEADS_PAGE_SIZE = 1000;

interface TeamLeadWithFactsRow {
  id: string;
  player_id: string;
  updated_at: string;
  lead_species: unknown;
  match: { status: MatchStatus } | null;
  tournament: { team_visibility: TeamVisibility } | null;
}

/** Every page of one ordered lead read, until a short page (none is cut off by `max_rows`). */
async function readTeamLeadPages(
  page: (from: number, to: number) => PromiseLike<{ data: TeamLeadWithFactsRow[] | null; error: unknown }>
): Promise<TeamLeadWithFactsRow[]> {
  const rows: TeamLeadWithFactsRow[] = [];
  for (let from = 0; ; from += TEAM_LEADS_PAGE_SIZE) {
    const { data, error } = await page(from, from + TEAM_LEADS_PAGE_SIZE - 1);
    if (error) throw error;
    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < TEAM_LEADS_PAGE_SIZE) return rows;
  }
}

/**
 * The team leads behind a league's public world aces, each with its spec §7
 * facts: the season's own rows (`teams.season_id`) and every row of its
 * stages (`teams.tournament_id`), which is where a played match's team lives
 * (`upsertTeamForMatch` links it to the match and its stage, not the season).
 * Without the stage rows a hidden_until_match league would show no aces at
 * all, although its completed matches' teams are public (spec §7).
 *
 * Reads the lead species by JSON path (the full sets never leave the
 * database) and the facts as embedded relations, so the caller decides
 * visibility without another read. A row found by both filters is returned
 * once. Order: season rows, then stage rows, each by `created_at` then `id`.
 * Errors propagate.
 */
export async function listSeasonTeamLeadsWithFacts(
  seasonId: string,
  stageIds: readonly string[]
): Promise<TeamLeadWithFacts[]> {
  const stages = [...new Set(stageIds)];
  const [seasonRows, stageRows] = await Promise.all([
    readTeamLeadPages((from, to) =>
      supabase
        .from('teams')
        .select(TEAM_LEAD_WITH_FACTS_SELECT)
        .eq('season_id', seasonId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)
    ),
    stages.length === 0
      ? Promise.resolve([])
      : readTeamLeadPages((from, to) =>
          supabase
            .from('teams')
            .select(TEAM_LEAD_WITH_FACTS_SELECT)
            .in('tournament_id', stages)
            .order('created_at', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to)
        ),
  ]);

  const seen = new Set<string>();
  const leads: TeamLeadWithFacts[] = [];
  for (const row of [...seasonRows, ...stageRows]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    leads.push({
      id: row.id,
      player_id: row.player_id,
      updated_at: row.updated_at,
      lead_species: typeof row.lead_species === 'string' ? row.lead_species : null,
      facts: {
        match_status: row.match?.status ?? null,
        tournament_visibility: row.tournament?.team_visibility ?? null,
      },
    });
  }
  return leads;
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
    .select(TEAM_COLUMNS)
    .single();

  if (error) throw error;
  return toTeam(data);
}

/**
 * How a team write treats a row linked to a COMPLETED match (lead ruling
 * round 5, `src/lib/team/completed-match-lock.ts`). By default the database
 * refuses it (trigger `teams_completed_match_lock`), surfaced as the
 * catalogued 409 `TeamMatchCompletedError`. `correction: true` writes through
 * `team_correct_update` / `team_correct_delete`, which the trigger lets
 * through: pass it ONLY after a live site-admin guard (an admin correction).
 */
export interface TeamWriteOptions {
  correction?: boolean;
}

/** Rewrite one row's roster through the admin correction function, then read it back. */
async function correctTeamRoster(
  id: string,
  pokemon: PokemonSet[],
  importSource: TeamImportSource,
  name?: string
): Promise<Team> {
  const { data: found, error } = await supabase.rpc('team_correct_update', {
    p_team_id: id,
    p_pokemon: pokemon as unknown as Json,
    p_import_source: importSource,
    ...(name !== undefined ? { p_name: name } : {}),
  });
  if (error) throw error;
  if (!found) throw new Error('Team not found');
  const team = await getTeamById(id);
  if (!team) throw new Error('Team not found');
  return team;
}

/**
 * Update a team's Pokémon (only if not locked). A row linked to a completed
 * match is refused with `TeamMatchCompletedError` unless `opts.correction`.
 */
export async function updateTeamPokemon(
  id: string,
  pokemon: PokemonSet[],
  importSource: Team['import_source'],
  name?: string,
  opts: TeamWriteOptions = {}
): Promise<Team> {
  // First verify the team is not locked
  const existing = await getTeamById(id);
  if (!existing) throw new Error('Team not found');
  if (existing.locked) throw new Error('Team is locked and cannot be edited');

  if (opts.correction) return correctTeamRoster(id, pokemon, importSource, name);

  const { data, error } = await supabase
    .from('teams')
    .update({
      pokemon: pokemon as unknown as Json,
      import_source: importSource,
      // Only send the column when a name was given (pre-migration safety)
      ...(name !== undefined ? { name } : {}),
    })
    .eq('id', id)
    .select(TEAM_COLUMNS)
    .single();

  if (error) throwTeamWriteError(error);
  return toTeam(data);
}

/**
 * Delete a team (only if not locked). A row linked to a completed match is
 * refused with `TeamMatchCompletedError` unless `opts.correction`.
 */
export async function deleteTeam(id: string, opts: TeamWriteOptions = {}): Promise<void> {
  const existing = await getTeamById(id);
  if (!existing) throw new Error('Team not found');
  if (existing.locked) throw new Error('Team is locked and cannot be deleted');

  if (opts.correction) {
    const { data: found, error } = await supabase.rpc('team_correct_delete', { p_team_id: id });
    if (error) throw error;
    if (!found) throw new Error('Team not found');
    return;
  }

  const { error } = await supabase
    .from('teams')
    .delete()
    .eq('id', id);

  if (error) throwTeamWriteError(error);
}

/**
 * Upsert a team linked to a specific match (used by match-prep sync).
 * - If a team already exists for (player_id, match_id) and is unlocked, updates it.
 * - If it exists but is locked, returns null (skip silently).
 * - If it doesn't exist, creates a new row.
 * Rewriting a row of a COMPLETED match is refused with
 * `TeamMatchCompletedError` unless `opts.correction` (a site-admin correction).
 */
export async function upsertTeamForMatch(
  playerId: string,
  matchId: string,
  tournamentId: string,
  pokemon: PokemonSet[],
  importSource: TeamImportSource,
  opts: TeamWriteOptions = {}
): Promise<Team | null> {
  // Check for existing team for this player + match
  const { data: existing, error: existingError } = await supabase
    .from('teams')
    .select(TEAM_COLUMNS)
    .eq('player_id', playerId)
    .eq('match_id', matchId)
    .maybeSingle();

  if (existingError) throw existingError;

  if (existing) {
    if (existing.locked) return null;

    if (opts.correction) return correctTeamRoster(existing.id, pokemon, importSource);

    const { data, error } = await supabase
      .from('teams')
      .update({
        pokemon: pokemon as unknown as Json,
        import_source: importSource,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select(TEAM_COLUMNS)
      .single();

    if (error) throwTeamWriteError(error);
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
    .select(TEAM_COLUMNS)
    .single();

  if (error) throw error;
  return toTeam(data);
}

/**
 * Release every team row linked to a match (match reset, match delete) WITHOUT
 * losing the player's planned team. `teams` is a shared teambuilder entity (it
 * also carries tournament_id/season_id/draft_pool_id), so the pointer is
 * cleared rather than the row deleted, mirroring the hard-delete FK
 * `ON DELETE SET NULL` behavior.
 *
 * A released match-prep row keeps its `tournament_id`, so it would look like a
 * second PLANNED row (no `match_id`) next to the player's real planned row, and
 * `getPlayerTeamForTournament` / `getPlayerTeamForMatch` treat two planned rows
 * as a data error (500 on the teambuilder and the per-match reads). So, after
 * the pointer is cleared, a released row whose player already has another
 * planned row in that tournament is moved to the player's personal teams
 * (`tournament_id` NULL). It is never deleted: it is the player's roster (it
 * shows in their teambuilder, and the reset also deletes the match's
 * `match_prep_teams`, so it may exist nowhere else), and a library entry or
 * share link on it keeps working. A released row with no planned sibling
 * becomes the planned row, as before.
 *
 * The pointer is cleared first (the `teams_completed_match_lock` trigger lets a
 * pointer-only change through while the match is still completed), and the
 * follow-up writes only touch rows that are no longer linked to any match.
 * Errors propagate. A failure after the pointer clear leaves two planned rows
 * that a retry cannot see (nothing is linked to the match any more); the
 * repair is moving the newer one to the personal teams (docs/match.md). Returns the number of rows released from the match.
 */
export async function clearTeamsMatchPointer(matchId: string): Promise<number> {
  const { data, error } = await supabase
    .from('teams')
    .update({ match_id: null })
    .eq('match_id', matchId)
    .select('id, player_id, tournament_id');

  if (error) throw error;
  const released = data ?? [];

  for (const row of released) {
    if (!row.tournament_id) continue;
    const { data: siblings, error: siblingError } = await supabase
      .from('teams')
      .select('id')
      .eq('player_id', row.player_id)
      .eq('tournament_id', row.tournament_id)
      .is('match_id', null)
      .neq('id', row.id)
      .limit(1);
    if (siblingError) throw siblingError;
    if ((siblings ?? []).length === 0) continue;

    const { error: moveError } = await supabase
      .from('teams')
      .update({ tournament_id: null })
      .eq('id', row.id)
      .is('match_id', null);
    if (moveError) throw moveError;
  }

  return released.length;
}

/**
 * Release the team rows of each match (`clearTeamsMatchPointer`) before the
 * matches are hard-deleted: the FK's `ON DELETE SET NULL` would otherwise leave
 * a released match-prep row as a second planned row. Sequential, so a row
 * released by one match is seen as the planned sibling of the next.
 */
export async function releaseTeamsFromMatches(matchIds: readonly string[]): Promise<void> {
  for (const matchId of matchIds) {
    await clearTeamsMatchPointer(matchId);
  }
}

/** One item's share of a species' sets (`PokemonDetailStats.items`). */
export interface ItemUsageRow {
  name: string;
  count: number;
  usage_percent: number;
}

/** Most items `getItemUsageForPokemon` returns (the SQL function caps at 200). */
export const ITEM_USAGE_LIMIT = 50;

/**
 * Item usage of one species in teams linked to a completed match (H9).
 *
 * Targeted read (aggregates hold no item data): the SQL function
 * `get_item_usage_for_pokemon` filters, expands and counts in the database
 * and returns one row per item, ordered by count and capped at
 * `ITEM_USAGE_LIMIT`, so no team JSONB crosses the wire and no `max_rows`
 * cap can truncate the counts. `usage_percent` is relative to every counted
 * set in scope (sets that hold an item), including items past the cap.
 * Scope follows the match (`league` = every stage of the season) and
 * `all_time` leaves out test seasons and test accounts.
 */
export async function getItemUsageForPokemon(
  pokemonName: string,
  scopeType: AggregateScope,
  scopeId: string | null,
  playerId?: string
): Promise<ItemUsageRow[]> {
  const { data, error } = await supabase.rpc('get_item_usage_for_pokemon', {
    p_species: pokemonName,
    p_scope_type: scopeType,
    ...(scopeId ? { p_scope_id: scopeId } : {}),
    ...(playerId ? { p_player_id: playerId } : {}),
    p_limit: ITEM_USAGE_LIMIT,
  });

  if (error) throw error;
  return (data ?? []).map((row) => ({
    name: row.item,
    count: Number(row.uses),
    usage_percent: Number(row.total_sets) > 0 ? (Number(row.uses) / Number(row.total_sets)) * 100 : 0,
  }));
}

// ── Visibility facts (spec §7) ───────────────────────────────────────

/** What spec §7 decides a team's roster visibility on, besides the viewer. */
export interface TeamVisibilityFacts {
  /** Status of the match the row is linked to (`teams.match_id`); null for planned rows. */
  match_status: MatchStatus | null;
  /** The tournament's `team_visibility` setting; null for personal teams. */
  tournament_visibility: TeamVisibility | null;
}

/** Ids per `.in()` request: keeps the query string short. */
const VISIBILITY_FACTS_CHUNK = 100;

/**
 * The visibility facts of `teamIds`, keyed by team id: the linked match's
 * status and the tournament's `team_visibility`, read through the row's own
 * foreign keys in one query per 100 ids. A team id with no row is absent
 * from the map (the caller treats it as hidden).
 */
export async function getTeamVisibilityFacts(
  teamIds: readonly string[]
): Promise<Map<string, TeamVisibilityFacts>> {
  const ids = [...new Set(teamIds)];
  const facts = new Map<string, TeamVisibilityFacts>();

  for (let i = 0; i < ids.length; i += VISIBILITY_FACTS_CHUNK) {
    const chunk = ids.slice(i, i + VISIBILITY_FACTS_CHUNK);
    const { data, error } = await supabase
      .from('teams')
      .select(
        'id, match:matches!teams_match_id_fkey(status), tournament:tournaments!teams_tournament_id_fkey(team_visibility)'
      )
      .in('id', chunk);

    if (error) throw error;
    for (const row of data ?? []) {
      facts.set(row.id, {
        match_status: row.match?.status ?? null,
        tournament_visibility: row.tournament?.team_visibility ?? null,
      });
    }
  }

  return facts;
}

// ── Share link queries ───────────────────────────────────────────────

/**
 * Get a team by its share token (public, no auth). Only an enabled link
 * matches. The returned `Team` carries no share columns.
 */
export async function getTeamByShareToken(shareToken: string): Promise<Team | null> {
  const { data, error } = await supabase
    .from('teams')
    .select(TEAM_COLUMNS)
    .eq('share_token', shareToken)
    .not('share_enabled_at', 'is', null)
    .maybeSingle();

  if (error) throw error;
  return data ? toTeam(data) : null;
}

/**
 * Enable or regenerate a share link for a team. The returned link is the
 * only place a share token leaves this module: the owner's share route hands
 * it to the owner and nobody else.
 */
export async function setTeamShareToken(teamId: string): Promise<TeamShareLink> {
  const { data, error } = await supabase
    .from('teams')
    .update({
      share_token: crypto.randomUUID(),
      share_enabled_at: new Date().toISOString(),
    })
    .eq('id', teamId)
    .select('id, share_token, share_enabled_at')
    .single();

  if (error) throw error;
  if (!data.share_token || !data.share_enabled_at) {
    throw new Error(`setTeamShareToken: team ${teamId} came back without a share link`);
  }
  return {
    team_id: data.id,
    share_token: data.share_token,
    share_enabled_at: data.share_enabled_at,
  };
}

/** Disable a share link for a team. */
export async function disableTeamShareToken(teamId: string): Promise<void> {
  const { error } = await supabase
    .from('teams')
    .update({
      share_token: null,
      share_enabled_at: null,
    })
    .eq('id', teamId);

  if (error) throw error;
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
    // User text: quoted and LIKE-escaped, so it cannot add conditions (L1).
    query = query.or(ilikeAnyOf(['library_title', 'library_description'], params.search));
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
    .select(TEAM_COLUMNS)
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
    .select(TEAM_COLUMNS)
    .single();

  if (error) throw error;
  return toTeam(data);
}

/**
 * Copy `source`'s Pokémon into a new personal team of `targetPlayerId`
 * (no tournament, no season). The caller authorizes the fork first
 * (`checkTeamForkAccess` in `src/lib/team/visibility.ts`): a fork never
 * enters a tournament, so the team submission guards of `POST /api/teams`
 * cannot be bypassed through it.
 */
export async function forkTeam(source: Team, targetPlayerId: string): Promise<Team> {
  const { data, error } = await supabase
    .from('teams')
    .insert({
      player_id: targetPlayerId,
      tournament_id: null,
      season_id: null,
      pokemon: source.pokemon as unknown as Json,
      import_source: 'manual',
      forked_from_team_id: source.id,
    })
    .select(TEAM_COLUMNS)
    .single();

  if (error) throw error;
  return toTeam(data);
}

/** One team row as the ruleset pin check reads it: the roster and whose it is, nothing else. */
export interface PinImpactTeam {
  id: string;
  player_id: string;
  pokemon: PokemonSet[];
}

/**
 * The teams a ruleset pin governs, for the check that counts how many would become invalid when the pin moves
 * (`src/lib/ruleset-studio/pin-impact.server.ts`): a league's own teams (`season_id`, no phase) or a phase's or standalone
 * tournament's teams (`tournament_id`). A team that can no longer change is left out: a manually locked row, and a row linked
 * to a completed match (`isCompletedMatchLocked`), whose roster is history. Reads the roster only (no share or library
 * columns), in `.range()` pages, and returns at most `limit` teams with `truncated` set when there were more.
 */
export async function listTeamsForPinImpact(
  scope: { kind: 'season' | 'tournament'; id: string },
  limit: number
): Promise<{ teams: PinImpactTeam[]; truncated: boolean }> {
  const pages = Math.max(1, Math.ceil(limit / 1000));
  const { rows, truncated } = await readBoundedPages<{
    id: string;
    player_id: string;
    pokemon: Json;
    match: { status: MatchStatus } | null;
  }>(
    (from, to) => {
      const query = supabase
        .from('teams')
        .select('id, player_id, pokemon, match:matches!teams_match_id_fkey(status)')
        .eq('locked', false);
      const scoped =
        scope.kind === 'season'
          ? query.eq('season_id', scope.id).is('tournament_id', null)
          : query.eq('tournament_id', scope.id);
      return scoped.order('id').range(from, to) as unknown as PromiseLike<{
        data: Array<{ id: string; player_id: string; pokemon: Json; match: { status: MatchStatus } | null }> | null;
        error: unknown;
      }>;
    },
    { label: 'listTeamsForPinImpact', maxPages: pages }
  );
  const open = rows.filter((row) => !isCompletedMatchLocked(row.match?.status));
  return {
    teams: open.slice(0, limit).map((row) => ({ id: row.id, player_id: row.player_id, pokemon: row.pokemon as unknown as PokemonSet[] })),
    truncated: truncated || open.length > limit,
  };
}
