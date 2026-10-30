import { supabase } from '../client';
import type { Tables, TablesInsert } from '@/types/database';
import type {
  DraftPool,
  DraftPoolWithDetails,
  DraftPoolFormData,
  DraftPick,
  DraftPickOrder,
  DraftPickWithPlayer,
  MakePickInput,
} from '@/types/draft';
import { DRAFT_PICK_ORDERS } from '@/types/draft';
import { defaultPickOrder } from '@/lib/draft/pool-format';
import type {
  ActorRole,
  AdminPoolSummary,
  DraftEngine,
  DraftKind,
  DraftMode,
  DraftPhase,
  PauseReason,
} from '@/types/draft-queue';
import { DELETABLE_QUEUE_PHASES, isDeletableQueuePhase } from '@/types/draft-queue';
import type { GroupedPoolSummary } from '@/types/season-group';
import { DraftRuleError } from '@/lib/draft/errors';

type DraftPoolRow = Tables<'draft_pools'>;
type DraftPickRow = Tables<'draft_picks'>;

function narrow<T extends string>(value: string | null | undefined, allowed: readonly T[]): T | undefined {
  return value !== null && value !== undefined && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

const ENGINES: readonly DraftEngine[] = ['legacy', 'queue'];
const KINDS: readonly DraftKind[] = ['initial', 'redraft'];
const MODES: readonly DraftMode[] = ['live', 'slow'];
const PHASES: readonly DraftPhase[] = ['setup', 'submissions', 'drafting', 'complete', 'cancelled'];
const PAUSE_REASONS: readonly PauseReason[] = ['admin', 'blocked_slot'];
const ACTOR_ROLES: readonly ActorRole[] = ['player', 'admin', 'system'];

function toDraftPool(row: DraftPoolRow): DraftPool {
  return {
    id: row.id,
    season_id: row.season_id,
    draft_type: row.draft_type,
    // A row read without the column (pre-migration) keeps its old behaviour: the order its draft_type implied.
    pick_order: narrow<DraftPickOrder>(row.pick_order, DRAFT_PICK_ORDERS) ?? defaultPickOrder(row.draft_type),
    point_budget: row.point_budget,
    pool_mode: row.pool_mode ?? 'tier',
    default_point_cost: row.default_point_cost ?? null,
    team_size_mode: row.team_size_mode ?? null,
    team_size_exact: row.team_size_exact ?? null,
    team_size_min: row.team_size_min ?? null,
    team_size_max: row.team_size_max ?? null,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    // Queue engine (M2); legacy rows carry the column defaults (CHECK-constrained text columns).
    engine: narrow(row.engine, ENGINES) ?? 'legacy',
    kind: narrow(row.kind, KINDS) ?? 'initial',
    mode: narrow(row.mode, MODES) ?? 'live',
    phase: narrow(row.phase, PHASES) ?? 'setup',
    list_version_id: row.list_version_id,
    parent_pool_id: row.parent_pool_id,
    roster_size: row.roster_size,
    pick_seconds: row.pick_seconds,
    makeup_seconds: row.makeup_seconds,
    slow_ladder_seconds: row.slow_ladder_seconds,
    extension_seconds: row.extension_seconds,
    extensions_enabled: row.extensions_enabled,
    redraft_max_lines: row.redraft_max_lines,
    redraft_lock_no_redraft_lines: row.redraft_lock_no_redraft_lines,
    submission_deadline_at: row.submission_deadline_at,
    submissions_published_at: row.submissions_published_at,
    token_purchase_closes_at: row.token_purchase_closes_at,
    paused_at: row.paused_at,
    paused_by: row.paused_by,
    pause_reason: narrow(row.pause_reason, PAUSE_REASONS) ?? null,
    state_version: row.state_version,
    publish_notified_at: row.publish_notified_at,
    started_at: row.started_at,
    ended_at: row.ended_at,
    created_by: row.created_by,
    // League groups (20261018180000); a row read without the column (mock, pre-migration) is ungrouped.
    season_group_id: row.season_group_id ?? null,
  };
}

function toDraftPick(row: DraftPickRow): DraftPick {
  return {
    id: row.id,
    draft_pool_id: row.draft_pool_id,
    player_id: row.player_id,
    pokemon_name: row.pokemon_name,
    pick_number: row.pick_number,
    round: row.round,
    points_spent: row.points_spent,
    timestamp: row.timestamp,
    // Line identity (M1) and queue engine (M2).
    line_id: row.line_id,
    line_entry_id: row.line_entry_id,
    slot_id: row.slot_id,
    redraft_slot_id: row.redraft_slot_id,
    client_request_id: row.client_request_id,
    made_by: row.made_by,
    made_by_role: narrow(row.made_by_role, ACTOR_ROLES) ?? null,
    override_reason: row.override_reason,
    voided_at: row.voided_at,
    voided_by: row.voided_by,
    void_reason: row.void_reason,
  };
}

// ─── Draft Pools ────────────────────────────────────────────────────

export async function getDraftPoolById(id: string): Promise<DraftPool | null> {
  const { data, error } = await supabase
    .from('draft_pools')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data ? toDraftPool(data) : null;
}

/**
 * `getDraftPoolBySeason` was asked about a league with groups: such a league has one pool per group, so "the season's
 * pool" does not exist. The caller must resolve the viewer's group pool (`getDraftPoolBySeasonGroup`) or list the pools
 * (`getDraftPoolsBySeasonWithGroups`). A programming error, never a user-facing one: it surfaces as a logged 500.
 */
export class GroupedLeaguePoolLookupError extends Error {
  readonly seasonId: string;

  constructor(seasonId: string) {
    super(
      `getDraftPoolBySeason(${seasonId}): the league has groups (one pool per group); ` +
        'use getDraftPoolBySeasonGroup or getDraftPoolsBySeasonWithGroups',
    );
    this.name = 'GroupedLeaguePoolLookupError';
    this.seasonId = seasonId;
  }
}

/** `seasons ( season_groups ( count ) )` embed of a draft_pools row; absent in mocks and pre-migration reads. */
function embeddedGroupCount(row: unknown): number {
  if (typeof row !== 'object' || row === null || !('seasons' in row)) return 0;
  const season: unknown = row.seasons;
  if (typeof season !== 'object' || season === null || !('season_groups' in season)) return 0;
  const groups: unknown = season.season_groups;
  if (!Array.isArray(groups) || groups.length === 0) return 0;
  const first: unknown = groups[0];
  if (typeof first !== 'object' || first === null || !('count' in first)) return 0;
  return typeof first.count === 'number' ? first.count : 0;
}

/**
 * The season's first pool (its initial draft), for a league WITHOUT groups. A queue-engine season can also
 * hold a redraft pool; `getDraftPoolsBySeason` lists every pool.
 *
 * A league with groups has one initial pool per group: this lookup refuses it loudly
 * (`GroupedLeaguePoolLookupError`) instead of returning one group's pool for everyone, also before any group has a
 * pool. Same single query as before when a pool exists (the group count rides along as an embed); a league without
 * any pool adds one head count of its groups.
 */
export async function getDraftPoolBySeason(seasonId: string): Promise<DraftPool | null> {
  const { data, error } = await supabase
    .from('draft_pools')
    .select('*, seasons ( season_groups ( count ) )')
    .eq('season_id', seasonId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    // No pool yet. A league that already has groups (created, no group drafted yet) is still a grouped league: the
    // lookup refuses it the same way, so no caller reads "no draft" for it (one head count, only on this branch).
    const { count, error: groupsError } = await supabase
      .from('season_groups')
      .select('id', { count: 'exact', head: true })
      .eq('season_id', seasonId);
    if (groupsError) throw groupsError;
    if ((count ?? 0) > 0) throw new GroupedLeaguePoolLookupError(seasonId);
    return null;
  }
  // Thrown, not logged here: the caller's safeErrorResponse logs it (or the season ledger takes its grouped path).
  if (data.season_group_id != null || embeddedGroupCount(data) > 0) throw new GroupedLeaguePoolLookupError(seasonId);
  return toDraftPool(data);
}

/**
 * A league group's pool of one kind: its initial pool, or its live (not cancelled) redraft pool. `seasonGroupId`
 * null = a league without groups (the pool whose group is NULL). At most one row matches either way (unique keys
 * `uq_draft_pools_season_initial` / `uq_draft_pools_season_redraft`, NULLS NOT DISTINCT).
 */
export async function getDraftPoolBySeasonGroup(
  seasonId: string,
  seasonGroupId: string | null,
  kind: DraftKind = 'initial',
): Promise<DraftPool | null> {
  let query = supabase.from('draft_pools').select('*').eq('season_id', seasonId).eq('kind', kind);
  query = seasonGroupId === null ? query.is('season_group_id', null) : query.eq('season_group_id', seasonGroupId);
  if (kind === 'redraft') query = query.neq('phase', 'cancelled');
  const { data, error } = await query.maybeSingle();

  if (error) throw error;
  return data ? toDraftPool(data) : null;
}

const GROUPED_POOL_COLUMNS =
  'id, engine, kind, phase, mode, status, season_group_id, parent_pool_id, point_budget, created_at, season_groups ( name, sort_order )';

/**
 * Every pool of a season with its group (name and position), ordered by group position, then creation (a league
 * without groups: creation order, group fields null). One query: the draft room's pool list, the admin Draft tab's
 * per-group cards and the season ledger read it.
 */
export async function getDraftPoolsBySeasonWithGroups(
  seasonId: string,
): Promise<(GroupedPoolSummary & { point_budget: number | null })[]> {
  const { data, error } = await supabase
    .from('draft_pools')
    .select(GROUPED_POOL_COLUMNS)
    .eq('season_id', seasonId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  const rows = (data ?? []).map((row) => ({
    id: row.id,
    engine: narrow(row.engine, ENGINES) ?? 'legacy',
    kind: narrow(row.kind, KINDS) ?? 'initial',
    phase: narrow(row.phase, PHASES) ?? 'setup',
    mode: narrow(row.mode, MODES) ?? 'live',
    status: row.status,
    season_group_id: row.season_group_id,
    season_group_name: row.season_groups?.name ?? null,
    season_group_sort_order: row.season_groups?.sort_order ?? null,
    parent_pool_id: row.parent_pool_id,
    point_budget: row.point_budget,
    created_at: row.created_at,
  }));
  // Stable: creation order inside a group; ungrouped pools (null position) keep creation order.
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => (a.row.season_group_sort_order ?? 0) - (b.row.season_group_sort_order ?? 0) || a.index - b.index)
    .map(({ row }) => row);
}

/**
 * Every pool of a season in creation order (oldest first), as the draft-room
 * page's `selectPool` and the admin pool list (route #2) take them. Narrow
 * columns only. No fallback (lead ruling round 5, AGENTS.md rule 5): a failed
 * read throws, a schema without the queue-engine columns included (the release
 * order is migrate first, README "Release order"), so no page reads "no draft"
 * from an error.
 */
export async function getDraftPoolsBySeason(seasonId: string): Promise<AdminPoolSummary[]> {
  const { data, error } = await supabase
    .from('draft_pools')
    .select('id, engine, kind, phase, mode, status')
    .eq('season_id', seasonId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    // An unknown engine value is treated as legacy: the queue pages never open it.
    engine: narrow(row.engine, ENGINES) ?? 'legacy',
    kind: narrow(row.kind, KINDS) ?? 'initial',
    phase: narrow(row.phase, PHASES) ?? 'setup',
    mode: narrow(row.mode, MODES) ?? 'live',
    status: row.status,
  }));
}

export async function getDraftPoolWithDetails(id: string): Promise<DraftPoolWithDetails | null> {
  const { data, error } = await supabase
    .from('draft_pools')
    .select(`
      *,
      seasons ( name ),
      draft_picks ( id )
    `)
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  // Get participant count from the season
  const { count, error: countErr } = await supabase
    .from('season_participants')
    .select('*', { count: 'exact', head: true })
    .eq('season_id', data.season_id);

  if (countErr) throw countErr;

  return {
    ...toDraftPool(data),
    season_name: (data.seasons as { name: string } | null)?.name ?? '',
    participant_count: count ?? 0,
    pick_count: (data.draft_picks as { id: string }[])?.length ?? 0,
  };
}

export async function listDraftPools(): Promise<DraftPoolWithDetails[]> {
  const { data, error } = await supabase
    .from('draft_pools')
    .select(`
      *,
      seasons ( name ),
      draft_picks ( id )
    `)
    .order('created_at', { ascending: false });

  if (error) throw error;

  // Batch-fetch participant counts for all seasons in a single query
  const seasonIds = Array.from(new Set(data.map((r) => r.season_id)));
  const participantCounts: Record<string, number> = {};
  if (seasonIds.length > 0) {
    const { data: rows, error: countErr } = await supabase
      .from('season_participants')
      .select('season_id')
      .in('season_id', seasonIds);
    if (countErr) throw countErr;
    for (const row of rows ?? []) {
      participantCounts[row.season_id] = (participantCounts[row.season_id] ?? 0) + 1;
    }
  }

  return data.map((row) => ({
    ...toDraftPool(row),
    season_name: (row.seasons as { name: string } | null)?.name ?? '',
    participant_count: participantCounts[row.season_id] ?? 0,
    pick_count: (row.draft_picks as { id: string }[])?.length ?? 0,
  }));
}

export async function createDraftPool(input: DraftPoolFormData): Promise<DraftPool> {
  const insert: TablesInsert<'draft_pools'> = {
    season_id: input.season_id,
    draft_type: input.draft_type,
    pick_order: input.pick_order ?? defaultPickOrder(input.draft_type),
    point_budget: input.point_budget ?? null,
    pool_mode: input.pool_mode ?? 'tier',
    default_point_cost: input.default_point_cost ?? null,
    team_size_mode: input.team_size_mode ?? null,
    team_size_exact: input.team_size_exact ?? null,
    team_size_min: input.team_size_min ?? null,
    team_size_max: input.team_size_max ?? null,
  };

  const { data, error } = await supabase
    .from('draft_pools')
    .insert(insert)
    .select()
    .single();

  if (error) throw error;
  return toDraftPool(data);
}

export async function updateDraftPoolStatus(
  id: string,
  status: DraftPool['status']
): Promise<DraftPool> {
  const { data, error } = await supabase
    .from('draft_pools')
    .update({ status })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return toDraftPool(data);
}

/**
 * Legacy pools: switch a running draft in snake/linear order to free order (`POST /api/drafts/[id]/free-order`).
 * The WHERE re-checks engine, status and order in the same statement, so a concurrent change cannot be overwritten;
 * null = no row matched (the caller re-reads the pool to say why).
 */
export async function switchDraftPoolToFreeOrder(id: string): Promise<DraftPool | null> {
  const { data, error } = await supabase
    .from('draft_pools')
    .update({ pick_order: 'free' })
    .eq('id', id)
    .eq('engine', 'legacy')
    .eq('status', 'in_progress')
    .neq('pick_order', 'free')
    .select()
    .maybeSingle();

  if (error) throw error;
  return data ? toDraftPool(data) : null;
}

/**
 * Legacy pools: only while pending (the DELETE filters on the status too). Queue-engine pools: only in phase
 * `setup` or `cancelled` (design decision); `draft_cancel` writes
 * status 'complete' with phase 'cancelled', so the phase decides, not the status.
 *
 * The read is only a fast refusal. The DELETE filters on the phase (queue) or the status (legacy) itself and counts the
 * rows it removed, so a Start that lands between the read and the DELETE (a second admin, a double click) deletes
 * nothing and answers `409 POOL_NOT_DELETABLE` (queue: with the phase as re-read); without the filter it would
 * cascade a started draft's picks and slots away.
 */
export async function deleteDraftPool(id: string): Promise<void> {
  const pool = await getDraftPoolById(id);
  if (!pool) throw new Error('Draft pool not found');
  if (pool.engine === 'queue') {
    if (!isDeletableQueuePhase(pool.phase)) {
      // A Start between the route's read and this one: the same catalogued 409 as the filtered DELETE below.
      throw new DraftRuleError('POOL_NOT_DELETABLE', undefined, { phase: pool.phase });
    }
    const { data, error } = await supabase
      .from('draft_pools')
      .delete()
      .eq('id', id)
      .in('phase', [...DELETABLE_QUEUE_PHASES])
      .select('id');
    if (error) throw error;
    if (!data || data.length === 0) await refuseLostDeleteRace(id, true);
    return;
  }
  if (pool.status !== 'pending') {
    throw new DraftRuleError('POOL_NOT_DELETABLE');
  }

  const { data, error } = await supabase
    .from('draft_pools')
    .delete()
    .eq('id', id)
    .eq('status', 'pending')
    .select('id');

  if (error) throw error;
  if (!data || data.length === 0) await refuseLostDeleteRace(id, false);
}

/**
 * The DELETE removed no row: the pool was started (or deleted) after `deleteDraftPool` read it. Re-reads the pool and
 * refuses with `POOL_NOT_FOUND` if it is gone, otherwise with `POOL_NOT_DELETABLE`. Only a queue pool's phase is
 * rendered as `detail.phase`; a legacy pool carries the column default there, so it is left out.
 */
async function refuseLostDeleteRace(id: string, queue: boolean): Promise<never> {
  const current = await getDraftPoolById(id);
  if (!current) throw new DraftRuleError('POOL_NOT_FOUND');
  throw new DraftRuleError('POOL_NOT_DELETABLE', undefined, queue ? { phase: current.phase } : undefined);
}

// ─── Draft Picks ────────────────────────────────────────────────────

export async function getPicksByPool(poolId: string): Promise<DraftPickWithPlayer[]> {
  const { data, error } = await supabase
    .from('draft_picks')
    .select(`
      *,
      players!draft_picks_player_id_fkey ( name )
    `)
    .eq('draft_pool_id', poolId)
    .order('pick_number');

  if (error) throw error;

  return data.map((row) => ({
    ...toDraftPick(row),
    player_name: (row.players as { name: string } | null)?.name ?? '',
  }));
}

/**
 * A player's picks in one pool, in pick order, WITHOUT the voided ones (`voided_at` set: the queue engine voids a pick
 * instead of deleting it). It reads that one pool only: a Redraft's picks are in the Redraft pool, and what a trainer
 * owns after a Redraft is decided elsewhere (the trackers, in an Evolution Point Buy league).
 */
export async function getPicksByPlayer(
  poolId: string,
  playerId: string
): Promise<DraftPick[]> {
  const { data, error } = await supabase
    .from('draft_picks')
    .select('*')
    .eq('draft_pool_id', poolId)
    .eq('player_id', playerId)
    .is('voided_at', null)
    .order('pick_number');

  if (error) throw error;
  return data.map(toDraftPick);
}

export async function createDraftPick(input: MakePickInput & {
  pick_number: number;
  round: number;
  /** EPB line of the pick (branch-exact undo and line availability); null for non-EPB drafts. */
  line_id?: string | null;
  /** `point_buy_list_entries.id` of that line. */
  line_entry_id?: string | null;
}): Promise<DraftPick> {
  const insert: TablesInsert<'draft_picks'> = {
    draft_pool_id: input.draft_pool_id,
    player_id: input.player_id,
    pokemon_name: input.pokemon_name,
    pick_number: input.pick_number,
    round: input.round,
    points_spent: input.points_spent ?? null,
    line_id: input.line_id ?? null,
    line_entry_id: input.line_entry_id ?? null,
  };

  const { data, error } = await supabase
    .from('draft_picks')
    .insert(insert)
    .select()
    .single();

  if (error) throw error;
  return toDraftPick(data);
}

export async function undoLastPick(
  poolId: string
): Promise<{ player_id: string; pokemon_name: string; line_id: string | null }> {
  // Find the most recent pick (player_id + pokemon_name + line_id for tracker cleanup;
  // line_id is null on legacy rows, which fall back to the base name)
  const { data, error } = await supabase
    .from('draft_picks')
    .select('id, player_id, pokemon_name, line_id')
    .eq('draft_pool_id', poolId)
    .order('pick_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('No picks to undo');

  const { error: delError } = await supabase
    .from('draft_picks')
    .delete()
    .eq('id', data.id);

  if (delError) throw delError;

  return { player_id: data.player_id, pokemon_name: data.pokemon_name, line_id: data.line_id ?? null };
}

export async function getPickCount(poolId: string): Promise<number> {
  const { count, error } = await supabase
    .from('draft_picks')
    .select('*', { count: 'exact', head: true })
    .eq('draft_pool_id', poolId);

  if (error) throw error;
  return count ?? 0;
}
