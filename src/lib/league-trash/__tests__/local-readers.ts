/**
 * Reads a seeded league back through supabase-js for the opt-in `league-trash.local.test.ts`: which rows of which table
 * belong to it (by EVERY key a delete could miss), row counts per key, and a per-table fingerprint (count + md5 of the
 * rows minus the columns that legitimately change across a delete and a restore). Not a unit test.
 */
import { createHash } from 'node:crypto';
import type { Client, LeagueIds } from './local-fixture';

const PAGE = 1000;
/** Ids per `.in()` filter: a uuid filter value is ~40 characters and PostgREST reads the URL, not a body. */
const IN_CHUNK = 60;

type KeyName = 'season' | 'phases' | 'tournamentGroups' | 'matches' | 'games' | 'pools' | 'notes';

interface KeySpec {
  column: string;
  keys: KeyName;
  /** Extra equality filters (polymorphic tables). */
  where?: Record<string, string>;
}

interface TableSpec {
  table: string;
  /** Columns to order by while paging (the primary key). */
  order: string[];
  /** The first key reads the league's rows; ALL keys are counted for the "zero rows" check. */
  by: KeySpec[];
}

const bySeason = (column = 'season_id'): KeySpec => ({ column, keys: 'season' });
const byPhases = (column = 'tournament_id'): KeySpec => ({ column, keys: 'phases' });
const byMatches = (column = 'match_id'): KeySpec => ({ column, keys: 'matches' });
const byPools = (column = 'draft_pool_id'): KeySpec => ({ column, keys: 'pools' });
const scoped = (scopeColumn: string, idColumn: string, typeValues: [string, string]): KeySpec[] => [
  { column: idColumn, keys: 'season', where: { [scopeColumn]: typeValues[0] } },
  { column: idColumn, keys: 'phases', where: { [scopeColumn]: typeValues[1] } },
];

/** The 50 owned tables of `league_trash__inventory()` (the local test compares this list with the database). */
export const OWNED_SPECS: readonly TableSpec[] = [
  { table: 'seasons', order: ['id'], by: [{ column: 'id', keys: 'season' }] },
  { table: 'season_participants', order: ['season_id', 'player_id'], by: [bySeason()] },
  { table: 'season_groups', order: ['id'], by: [bySeason()] },
  { table: 'season_group_members', order: ['season_id', 'player_id'], by: [bySeason()] },
  { table: 'season_formats', order: ['season_id'], by: [bySeason()] },
  { table: 'format_rules', order: ['id'], by: [bySeason()] },
  { table: 'evolution_tiers', order: ['id'], by: [bySeason()] },
  { table: 'draft_tier_limits', order: ['id'], by: [bySeason()] },
  { table: 'draft_pool_entries', order: ['id'], by: [bySeason()] },
  { table: 'legacy_standings', order: ['id'], by: [bySeason()] },
  { table: 'epb_kill_credit_epochs', order: ['season_id'], by: [bySeason()] },
  { table: 'epb_token_grants', order: ['season_id', 'player_id', 'grant_type'], by: [bySeason()] },
  { table: 'season_storylines', order: ['id'], by: [bySeason()] },
  { table: 'tournaments', order: ['id'], by: [bySeason()] },
  { table: 'tournament_participants', order: ['tournament_id', 'player_id'], by: [byPhases()] },
  { table: 'tournament_groups', order: ['id'], by: [byPhases()] },
  { table: 'tournament_group_members', order: ['group_id', 'player_id'], by: [{ column: 'group_id', keys: 'tournamentGroups' }] },
  { table: 'rounds', order: ['id'], by: [byPhases()] },
  { table: 'tournament_reports', order: ['id'], by: [byPhases()] },
  { table: 'matches', order: ['id'], by: [byPhases()] },
  { table: 'games', order: ['id'], by: [byMatches()] },
  { table: 'battle_stats', order: ['id'], by: [{ column: 'game_id', keys: 'games' }] },
  { table: 'match_analyses', order: ['id'], by: [byMatches()] },
  { table: 'match_prep_analyses', order: ['id'], by: [byMatches()] },
  { table: 'match_prep_teams', order: ['id'], by: [byMatches()] },
  { table: 'match_proposals', order: ['id'], by: [byMatches()] },
  { table: 'match_evolution_snapshots', order: ['id'], by: [byMatches()] },
  { table: 'epb_animation_views', order: ['id'], by: [byMatches()] },
  { table: 'broadcast_moments', order: ['id'], by: [byMatches(), { column: 'game_id', keys: 'games' }] },
  { table: 'draft_pools', order: ['id'], by: [bySeason()] },
  { table: 'draft_participants', order: ['draft_pool_id', 'player_id'], by: [byPools()] },
  { table: 'draft_slots', order: ['id'], by: [byPools()] },
  { table: 'draft_picks', order: ['id'], by: [byPools()] },
  { table: 'draft_replay_events', order: ['id'], by: [byPools()] },
  { table: 'draft_line_restrictions', order: ['draft_pool_id', 'player_id', 'line_id'], by: [byPools()] },
  { table: 'redraft_slots', order: ['id'], by: [bySeason(), byPools()] },
  { table: 'redraft_submissions', order: ['draft_pool_id', 'tracker_id'], by: [byPools()] },
  { table: 'evolution_tracker', order: ['id'], by: [bySeason()] },
  { table: 'evolution_events', order: ['id'], by: [bySeason()] },
  { table: 'evo_progress_log', order: ['id'], by: [bySeason()] },
  { table: 'epb_draft_token_purchases', order: ['id'], by: [bySeason()] },
  { table: 'epb_comeback_token_spends', order: ['id'], by: [bySeason()] },
  { table: 'redraft_history', order: ['id'], by: [bySeason()] },
  { table: 'redraft_trade_requests', order: ['id'], by: [bySeason()] },
  { table: 'teams', order: ['id'], by: [bySeason(), byPhases(), byPools()] },
  { table: 'resource_admins', order: ['id'], by: scoped('resource_type', 'resource_id', ['season', 'tournament']) },
  { table: 'discord_webhooks', order: ['id'], by: scoped('scope_type', 'scope_id', ['season', 'tournament']) },
  { table: 'social_integrations', order: ['id'], by: scoped('scope_type', 'scope_id', ['season', 'tournament']) },
  { table: 'wiki_notes', order: ['id'], by: scoped('scope_type', 'scope_id', ['league', 'tournament']) },
  { table: 'wiki_note_reports', order: ['id'], by: [{ column: 'note_id', keys: 'notes' }] },
];

/** Deleted with the league but never captured: rebuilt by the app. */
export const DERIVED_SPECS: readonly TableSpec[] = [
  { table: 'aggregates', order: ['id'], by: scoped('scope_type', 'scope_id', ['league', 'tournament']) },
  { table: 'player_aggregates', order: ['id'], by: scoped('scope_type', 'scope_id', ['league', 'tournament']) },
  { table: 'aggregate_jobs', order: ['id'], by: [{ column: 'game_id', keys: 'games' }] },
  { table: 'rating_history', order: ['id'], by: [byMatches()] },
];

/** Columns that legitimately differ after a delete + restore: shifted clocks, the aggregate marker, the freeze. */
const EXCLUDED: Readonly<Record<string, readonly string[]>> = {
  draft_pools: ['paused_at', 'paused_by', 'pause_reason', 'state_version', 'updated_at', 'submission_deadline_at', 'token_purchase_closes_at'],
  draft_slots: ['deadline_at', 'remaining_ms_at_pause'],
  matches: ['auto_confirm_at'],
  rounds: ['deadline'],
  match_proposals: ['expires_at'],
  games: ['aggregate_applied_at'],
};

function valuesFor(keys: KeyName, ids: LeagueIds): string[] {
  switch (keys) {
    case 'season':
      return [ids.seasonId];
    case 'phases':
      return ids.phaseIds;
    case 'tournamentGroups':
      return ids.tournamentGroupIds;
    case 'matches':
      return ids.matchIds;
    case 'games':
      return ids.gameIds;
    case 'pools':
      return ids.poolIds;
    case 'notes':
      return ids.noteIds;
  }
}

type Row = Record<string, unknown>;

/** Every row of `spec` that `key` selects, in primary-key order. */
async function readRows(client: Client, spec: TableSpec, key: KeySpec, ids: LeagueIds): Promise<Row[]> {
  const values = valuesFor(key.keys, ids);
  const rows: Row[] = [];
  for (let i = 0; i < values.length; i += IN_CHUNK) {
    const chunk = values.slice(i, i + IN_CHUNK);
    for (let from = 0; ; from += PAGE) {
      let query = client.from(spec.table).select('*').in(key.column, chunk);
      for (const [column, value] of Object.entries(key.where ?? {})) query = query.eq(column, value);
      for (const column of spec.order) query = query.order(column);
      const { data, error } = await query.range(from, from + PAGE - 1);
      if (error) throw new Error(`[local-readers] read ${spec.table} failed: ${error.message}`);
      rows.push(...(data as Row[]));
      if ((data?.length ?? 0) < PAGE) break;
    }
  }
  return rows;
}

/** Rows of `spec` per key (head counts, so a huge league does not travel). */
export async function countsByKey(client: Client, spec: TableSpec, ids: LeagueIds): Promise<number[]> {
  const counts: number[] = [];
  for (const key of spec.by) {
    const values = valuesFor(key.keys, ids);
    let total = 0;
    for (let i = 0; i < values.length; i += IN_CHUNK) {
      let query = client.from(spec.table).select('*', { count: 'exact', head: true }).in(key.column, values.slice(i, i + IN_CHUNK));
      for (const [column, value] of Object.entries(key.where ?? {})) query = query.eq(column, value);
      const { count, error } = await query;
      if (error) throw new Error(`[local-readers] count ${spec.table} failed: ${error.message}`);
      total += count ?? 0;
    }
    counts.push(total);
  }
  return counts;
}

export interface TableFingerprint {
  n: number;
  hash: string;
}

/** Count and md5 of every owned table's rows (the first key only: the keys of one table select the same rows). */
export async function fingerprintLeague(client: Client, ids: LeagueIds): Promise<Record<string, TableFingerprint>> {
  const out: Record<string, TableFingerprint> = {};
  for (const spec of OWNED_SPECS) {
    const excluded = new Set(EXCLUDED[spec.table] ?? []);
    const rows = await readRows(client, spec, spec.by[0], ids);
    const lines = rows
      .map((row) => JSON.stringify(Object.fromEntries(Object.entries(row).filter(([column]) => !excluded.has(column)))))
      .sort();
    out[spec.table] = { n: rows.length, hash: createHash('md5').update(lines.join('|')).digest('hex') };
  }
  return out;
}

/** The clock columns a restore shifts, as `table.column -> id -> value` (rows that qualify for a shift only). */
export async function readClocks(client: Client, ids: LeagueIds): Promise<Record<string, Record<string, string | null>>> {
  const spec = (table: string) => OWNED_SPECS.find((s) => s.table === table) as TableSpec;
  const clocks: Record<string, Record<string, string | null>> = {};
  const take = async (table: string, column: string, qualifies: (row: Row) => boolean) => {
    const rows = await readRows(client, spec(table), spec(table).by[0], ids);
    const map: Record<string, string | null> = {};
    for (const row of rows) if (qualifies(row)) map[row.id as string] = (row[column] as string | null) ?? null;
    clocks[`${table}.${column}`] = map;
  };
  await take('draft_pools', 'submission_deadline_at', (r) => r.phase !== 'complete');
  await take('draft_pools', 'token_purchase_closes_at', (r) => r.phase !== 'complete');
  await take('matches', 'auto_confirm_at', (r) => r.status === 'pending_confirmation');
  await take('match_proposals', 'expires_at', (r) => r.status === 'pending');
  await take('rounds', 'deadline', (r) => r.status !== 'completed');
  return clocks;
}
