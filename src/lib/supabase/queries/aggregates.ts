import { supabase } from '../client';
import type { Json, Tables } from '@/types/database';
import type { Aggregate, AggregateScope, BattleStat, PlayerAggregate } from '@/types/game';

type AggregateRow = Tables<'aggregates'>;
type PlayerAggregateRow = Tables<'player_aggregates'>;

function toAggregate(row: AggregateRow): Aggregate {
  return {
    id: row.id,
    scope_type: row.scope_type,
    scope_id: row.scope_id,
    pokemon_name: row.pokemon_name,
    total_appearances: row.total_appearances,
    total_brought: row.total_brought,
    total_led: row.total_led,
    total_kos_dealt: row.total_kos_dealt,
    total_koed: row.total_koed,
    total_wins: row.total_wins,
    total_games: row.total_games,
    move_counts: (row.move_counts as Record<string, number>) ?? {},
    last_updated: row.last_updated,
  };
}

// ─── Read ────────────────────────────────────────────────────────────

export async function getAggregates(
  scopeType: AggregateScope,
  scopeId: string | null
): Promise<Aggregate[]> {
  let query = supabase
    .from('aggregates')
    .select('*')
    .eq('scope_type', scopeType);

  if (scopeId) {
    query = query.eq('scope_id', scopeId);
  } else {
    query = query.is('scope_id', null);
  }

  const { data, error } = await query.order('total_appearances', { ascending: false });

  if (error) throw error;
  return data.map(toAggregate);
}

/**
 * An aggregate row without its per-move breakdown. `move_counts` is the
 * heavy JSON column and is NOT read: it is always the empty record here
 * (`Record<string, never>`), which keeps a summary assignable wherever an
 * `Aggregate` is only read for its counters (usage tables, standings).
 * Anything that shows move usage must call `getAggregates` instead.
 */
export type AggregateSummary = Omit<Aggregate, 'move_counts'> & {
  move_counts: Record<string, never>;
};

const AGGREGATE_SUMMARY_SELECT =
  'id, scope_type, scope_id, pokemon_name, total_appearances, total_brought, total_led, total_kos_dealt, total_koed, total_wins, total_games, last_updated';

/**
 * Counter columns only, for pages and overlays that render usage tables:
 * the same rows and order as `getAggregates`, without `move_counts`.
 */
export async function getAggregatesSummary(
  scopeType: AggregateScope,
  scopeId: string | null
): Promise<AggregateSummary[]> {
  let query = supabase
    .from('aggregates')
    .select(AGGREGATE_SUMMARY_SELECT)
    .eq('scope_type', scopeType);

  if (scopeId) {
    query = query.eq('scope_id', scopeId);
  } else {
    query = query.is('scope_id', null);
  }

  const { data, error } = await query.order('total_appearances', { ascending: false });

  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    scope_type: row.scope_type,
    scope_id: row.scope_id,
    pokemon_name: row.pokemon_name,
    total_appearances: row.total_appearances,
    total_brought: row.total_brought,
    total_led: row.total_led,
    total_kos_dealt: row.total_kos_dealt,
    total_koed: row.total_koed,
    total_wins: row.total_wins,
    total_games: row.total_games,
    move_counts: {},
    last_updated: row.last_updated,
  }));
}

// ─── Write (3-scope update) ──────────────────────────────────────────

/**
 * Updates aggregates for all 3 scopes after a game is recorded.
 * This is the core pre-computation pipeline per CLAUDE.md rule #4.
 *
 * Must be called atomically with every Game + BattleStat write.
 */
/**
 * Build the aggregate scopes for a game. When `excludeAllTime` is set, the
 * all_time (global) scope is omitted — used for test data (test seasons or
 * matches involving test accounts) so global stats stay uncontaminated.
 * Callers decide via shouldExcludeFromAllTime(); keeping this pure avoids
 * per-game DB lookups in the hot aggregate path and keeps increment/rollback
 * symmetric (both pass the same flag for the same game).
 */
function buildAggregateScopes(
  tournamentId: string,
  seasonId: string | null,
  excludeAllTime: boolean
): { type: AggregateScope; id: string | null }[] {
  const scopes: { type: AggregateScope; id: string | null }[] = [
    { type: 'tournament', id: tournamentId },
  ];
  if (!excludeAllTime) {
    scopes.push({ type: 'all_time', id: null });
  }
  if (seasonId) {
    scopes.push({ type: 'league', id: seasonId });
  }
  return scopes;
}

export async function updateAggregates(
  battleStats: BattleStat[],
  tournamentId: string,
  seasonId: string | null,
  opts?: { excludeAllTime?: boolean }
): Promise<void> {
  const scopes = buildAggregateScopes(tournamentId, seasonId, opts?.excludeAllTime === true);
  await applyAggregateDeltas(battleStats, scopes);
}

/**
 * Increment aggregates for a single scope only.
 * Used by admin scope rebuilds — does not touch other scopes.
 */
export async function updateAggregatesForScope(
  battleStats: BattleStat[],
  scopeType: AggregateScope,
  scopeId: string | null
): Promise<void> {
  await applyAggregateDeltas(battleStats, [{ type: scopeType, id: scopeId }]);
}

async function applyAggregateDeltas(
  battleStats: BattleStat[],
  scopes: { type: AggregateScope; id: string | null }[]
): Promise<void> {
  if (battleStats.length === 0 || scopes.length === 0) return;

  const aggDeltas = buildAggregateDeltas(battleStats, scopes);
  const playerDeltas = buildPlayerAggregateDeltas(battleStats, scopes);

  await Promise.all([
    batchUpsertAggregates(aggDeltas),
    batchUpsertPlayerAggregates(playerDeltas),
  ]);
}

// ─── Delta builders ─────────────────────────────────────────────────

interface AggregateDelta {
  scope_type: string;
  scope_id: string | null;
  pokemon_name: string;
  appearances: number;
  brought: number;
  led: number;
  kos_dealt: number;
  koed: number;
  wins: number;
  games: number;
  move_counts: Record<string, number>;
}

interface PlayerAggregateDelta extends AggregateDelta {
  player_id: string;
}

function computeStatDeltas(stats: BattleStat[]): Omit<AggregateDelta, 'scope_type' | 'scope_id' | 'pokemon_name'> {
  let appearances = 0, brought = 0, led = 0, kos_dealt = 0, koed = 0, wins = 0, games = 0;
  const move_counts: Record<string, number> = {};

  for (const stat of stats) {
    appearances++;
    if (stat.was_brought) brought++;
    if (stat.was_lead) led++;
    kos_dealt += stat.kos_dealt;
    if (stat.was_koed) koed++;
    if (stat.match_won) wins++;
    games++;
    for (const move of stat.moves_used) {
      move_counts[move] = (move_counts[move] ?? 0) + 1;
    }
  }

  return { appearances, brought, led, kos_dealt, koed, wins, games, move_counts };
}

function buildAggregateDeltas(
  battleStats: BattleStat[],
  scopes: { type: AggregateScope; id: string | null }[]
): AggregateDelta[] {
  const byPokemon = new Map<string, BattleStat[]>();
  for (const stat of battleStats) {
    const existing = byPokemon.get(stat.pokemon_name) ?? [];
    existing.push(stat);
    byPokemon.set(stat.pokemon_name, existing);
  }

  const deltas: AggregateDelta[] = [];
  for (const scope of scopes) {
    for (const [pokemonName, stats] of byPokemon) {
      deltas.push({
        scope_type: scope.type,
        scope_id: scope.id,
        pokemon_name: pokemonName,
        ...computeStatDeltas(stats),
      });
    }
  }
  return deltas;
}

function buildPlayerAggregateDeltas(
  battleStats: BattleStat[],
  scopes: { type: AggregateScope; id: string | null }[]
): PlayerAggregateDelta[] {
  const byPlayerPokemon = new Map<string, BattleStat[]>();
  for (const stat of battleStats) {
    const key = `${stat.player_id}::${stat.pokemon_name}`;
    const existing = byPlayerPokemon.get(key) ?? [];
    existing.push(stat);
    byPlayerPokemon.set(key, existing);
  }

  const deltas: PlayerAggregateDelta[] = [];
  for (const scope of scopes) {
    for (const [, stats] of byPlayerPokemon) {
      deltas.push({
        scope_type: scope.type,
        scope_id: scope.id,
        player_id: stats[0].player_id,
        pokemon_name: stats[0].pokemon_name,
        ...computeStatDeltas(stats),
      });
    }
  }
  return deltas;
}

// ─── Batch RPC calls ────────────────────────────────────────────────

async function batchUpsertAggregates(deltas: AggregateDelta[]): Promise<void> {
  if (deltas.length === 0) return;
  const { error } = await supabase.rpc('batch_upsert_aggregates', {
    p_deltas: deltas as unknown as Json[],
  });
  if (error) throw error;
}

async function batchUpsertPlayerAggregates(deltas: PlayerAggregateDelta[]): Promise<void> {
  if (deltas.length === 0) return;
  const { error } = await supabase.rpc('batch_upsert_player_aggregates', {
    p_deltas: deltas as unknown as Json[],
  });
  if (error) throw error;
}

// ─── Write (3-scope rollback) ────────────────────────────────────────

/**
 * Rolls back aggregates for all 3 scopes after a game is deleted.
 * Exact inverse of updateAggregates — decrements instead of increments.
 *
 * Must be called before deleting BattleStat / Game rows so the data
 * is still available for computing deltas.
 */
export async function rollbackAggregates(
  battleStats: BattleStat[],
  tournamentId: string,
  seasonId: string | null,
  opts?: { excludeAllTime?: boolean }
): Promise<void> {
  const scopes = buildAggregateScopes(tournamentId, seasonId, opts?.excludeAllTime === true);

  // Pre-compute all decrement deltas, then send 1 RPC per table
  // (was N×M read-modify-write round trips)
  const aggDeltas = buildAggregateDeltas(battleStats, scopes);
  const playerDeltas = buildPlayerAggregateDeltas(battleStats, scopes);

  await Promise.all([
    batchDecrementAggregates(aggDeltas),
    batchDecrementPlayerAggregates(playerDeltas),
  ]);
}

async function batchDecrementAggregates(deltas: AggregateDelta[]): Promise<void> {
  if (deltas.length === 0) return;
  const { error } = await supabase.rpc('batch_decrement_aggregates', {
    p_deltas: deltas as unknown as Json[],
  });
  if (error) throw error;
}

async function batchDecrementPlayerAggregates(deltas: PlayerAggregateDelta[]): Promise<void> {
  if (deltas.length === 0) return;
  const { error } = await supabase.rpc('batch_decrement_player_aggregates', {
    p_deltas: deltas as unknown as Json[],
  });
  if (error) throw error;
}

// ─── Scope maintenance (admin rebuild) ─────────────────────────────

export interface ClearAggregatesForScopeResult {
  aggregatesDeleted: number;
  playerAggregatesDeleted: number;
}

/**
 * Delete all aggregate rows for one scope before a full rebuild.
 */
export async function clearAggregatesForScope(
  scopeType: AggregateScope,
  scopeId: string | null
): Promise<ClearAggregatesForScopeResult> {
  let aggQuery = supabase.from('aggregates').delete({ count: 'exact' }).eq('scope_type', scopeType);
  let playerQuery = supabase
    .from('player_aggregates')
    .delete({ count: 'exact' })
    .eq('scope_type', scopeType);

  if (scopeId) {
    aggQuery = aggQuery.eq('scope_id', scopeId);
    playerQuery = playerQuery.eq('scope_id', scopeId);
  } else {
    aggQuery = aggQuery.is('scope_id', null);
    playerQuery = playerQuery.is('scope_id', null);
  }

  const [aggResult, playerResult] = await Promise.all([aggQuery, playerQuery]);

  if (aggResult.error) throw aggResult.error;
  if (playerResult.error) throw playerResult.error;

  return {
    aggregatesDeleted: aggResult.count ?? 0,
    playerAggregatesDeleted: playerResult.count ?? 0,
  };
}

// ─── Read (helpers) ─────────────────────────────────────────────────

/**
 * Get total number of completed games played in a scope (for calculating usage%).
 * Counts from the games table via matches, excluding scheduled matches.
 */
export async function getTotalGamesInScope(
  scopeType: AggregateScope,
  scopeId: string | null
): Promise<number> {
  // Count actual games from the games table, joining through matches
  // to filter by scope and exclude scheduled (unplayed) matches.
  const { data, error } = await supabase.rpc('get_total_games_in_scope', {
    p_scope_type: scopeType,
    p_scope_id: scopeId ?? '00000000-0000-0000-0000-000000000000',
  });
  if (error) throw error;
  return typeof data === 'number' ? data : 0;
}

// ─── Read (Pokemon detail page) ─────────────────────────────────────

function toPlayerAggregate(row: PlayerAggregateRow): PlayerAggregate {
  return {
    id: row.id,
    scope_type: row.scope_type,
    scope_id: row.scope_id,
    player_id: row.player_id,
    pokemon_name: row.pokemon_name,
    total_appearances: row.total_appearances,
    total_brought: row.total_brought,
    total_led: row.total_led,
    total_kos_dealt: row.total_kos_dealt,
    total_koed: row.total_koed,
    total_wins: row.total_wins,
    total_games: row.total_games,
    move_counts: (row.move_counts as Record<string, number>) ?? {},
    last_updated: row.last_updated,
  };
}

/**
 * Get all all-time player_aggregates rows for one player.
 * Used by gamification systems that derive player-level summaries.
 */
export async function getAllTimePlayerAggregates(
  playerId: string
): Promise<PlayerAggregate[]> {
  const { data, error } = await supabase
    .from('player_aggregates')
    .select('*')
    .eq('player_id', playerId)
    .eq('scope_type', 'all_time')
    .is('scope_id', null)
    .order('total_brought', { ascending: false });

  if (error) throw error;
  return data.map(toPlayerAggregate);
}

/** One Pokémon a player brought in one league or tournament (from player_aggregates). */
export interface PlayerScopeUsageRow {
  scope_type: 'league' | 'tournament';
  scope_id: string;
  pokemon_name: string;
  total_brought: number;
}

const PLAYER_SCOPE_USAGE_CHUNK = 1000;

function playerScopeUsagePage(playerId: string, from: number, withCount: boolean) {
  return supabase
    .from('player_aggregates')
    .select('id, scope_type, scope_id, pokemon_name, total_brought', withCount ? { count: 'exact' } : undefined)
    .eq('player_id', playerId)
    .in('scope_type', ['league', 'tournament'])
    .gt('total_brought', 0)
    // Unique tiebreaker, so no row repeats or vanishes between pages.
    .order('id', { ascending: true })
    .range(from, from + PLAYER_SCOPE_USAGE_CHUNK - 1);
}

/**
 * Every Pokémon a player brought, per league and per tournament scope. Paged
 * with `.range()` up to the exact count, so `max_rows` cannot truncate it.
 * League-stage games appear under both their stage (tournament scope) and
 * their league; callers decide which scope to show.
 */
export async function getPlayerScopeUsage(playerId: string): Promise<PlayerScopeUsageRow[]> {
  const rows: PlayerScopeUsageRow[] = [];
  let total: number | null = null;
  let from = 0;
  while (total === null || from < total) {
    const { data, error, count } = await playerScopeUsagePage(playerId, from, total === null);

    if (error) throw error;
    const chunk = data ?? [];
    if (total === null) total = count ?? chunk.length;
    if (chunk.length === 0) break; // rows were deleted while paging
    from += chunk.length;
    for (const row of chunk) {
      if ((row.scope_type !== 'league' && row.scope_type !== 'tournament') || row.scope_id === null) continue;
      rows.push({
        scope_type: row.scope_type,
        scope_id: row.scope_id,
        pokemon_name: row.pokemon_name,
        total_brought: row.total_brought,
      });
    }
  }
  return rows;
}

/**
 * Get global kill rankings for specific Pokémon by name.
 * Returns { rank, total_ranked } for each requested name, plus total count.
 * Used by profile composition to avoid fetching ALL global aggregates.
 *
 * Computes ranks in-memory from a single query instead of N+2 queries.
 */
export async function getGlobalKillRankForPokemon(
  pokemonNames: string[]
): Promise<{ rankings: Map<string, { rank: number; kos: number }>; totalRanked: number }> {
  if (pokemonNames.length === 0) {
    return { rankings: new Map(), totalRanked: 0 };
  }

  // Single query: fetch all all_time aggregates ordered by KOs descending
  const { data: allAggs, error } = await supabase
    .from('aggregates')
    .select('pokemon_name, total_kos_dealt')
    .eq('scope_type', 'all_time')
    .is('scope_id', null)
    .order('total_kos_dealt', { ascending: false });

  if (error) throw error;
  if (!allAggs) return { rankings: new Map(), totalRanked: 0 };

  const totalRanked = allAggs.length;
  const nameSet = new Set(pokemonNames);
  const rankings = new Map<string, { rank: number; kos: number }>();

  // Compute dense rank: rank = (count of entries with strictly more KOs) + 1
  let rank = 1;
  for (let i = 0; i < allAggs.length; i++) {
    if (i > 0 && allAggs[i].total_kos_dealt < allAggs[i - 1].total_kos_dealt) {
      rank = i + 1;
    }
    if (nameSet.has(allAggs[i].pokemon_name)) {
      rankings.set(allAggs[i].pokemon_name, {
        rank,
        kos: allAggs[i].total_kos_dealt,
      });
      // Early exit once all targets found
      if (rankings.size === nameSet.size) break;
    }
  }

  return { rankings, totalRanked };
}

/**
 * Get the aggregate for a single Pokémon in a given scope.
 */
export async function getAggregateForPokemon(
  pokemonName: string,
  scopeType: AggregateScope,
  scopeId: string | null
): Promise<Aggregate | null> {
  let query = supabase
    .from('aggregates')
    .select('*')
    .eq('scope_type', scopeType)
    .eq('pokemon_name', pokemonName);

  if (scopeId) {
    query = query.eq('scope_id', scopeId);
  } else {
    query = query.is('scope_id', null);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data ? toAggregate(data) : null;
}

/**
 * Get player_aggregates for a Pokémon in a given scope.
 * Optionally filter to a single player.
 */
export async function getPlayerAggregatesForPokemon(
  pokemonName: string,
  scopeType: AggregateScope,
  scopeId: string | null,
  playerId?: string
): Promise<PlayerAggregate[]> {
  let query = supabase
    .from('player_aggregates')
    .select('*')
    .eq('scope_type', scopeType)
    .eq('pokemon_name', pokemonName);

  if (scopeId) {
    query = query.eq('scope_id', scopeId);
  } else {
    query = query.is('scope_id', null);
  }

  if (playerId) {
    query = query.eq('player_id', playerId);
  }

  const { data, error } = await query.order('total_appearances', { ascending: false });
  if (error) throw error;
  return data.map(toPlayerAggregate);
}

/**
 * Get distinct scopes where a Pokémon has aggregate data.
 * Used by the Pokémon detail page to populate filter dropdowns.
 */
export async function getAggregateScopesForPokemon(
  pokemonName: string
): Promise<{ scope_type: AggregateScope; scope_id: string | null }[]> {
  const { data, error } = await supabase
    .from('aggregates')
    .select('scope_type, scope_id')
    .eq('pokemon_name', pokemonName);

  if (error) throw error;
  return data;
}

/**
 * Get distinct players who have used a Pokémon (from player_aggregates).
 * Returns player_id list (names resolved by the API route via players table).
 */
export async function getPlayerIdsForPokemon(
  pokemonName: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from('player_aggregates')
    .select('player_id')
    .eq('pokemon_name', pokemonName)
    .eq('scope_type', 'all_time');

  if (error) throw error;
  // Deduplicate
  return [...new Set(data.map((row) => row.player_id))];
}
