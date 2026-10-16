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

/** Postgres undefined_column (42703) or PostgREST unknown column in the schema cache (PGRST204). */
const MISSING_COLUMN_CODES: readonly string[] = ['42703', 'PGRST204'];

function isMissingColumnError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  const { code } = error;
  return typeof code === 'string' && MISSING_COLUMN_CODES.includes(code);
}

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
 * The season's first pool (its initial draft). A queue-engine season can also
 * hold a redraft pool; `getDraftPoolsBySeason` lists every pool.
 */
export async function getDraftPoolBySeason(seasonId: string): Promise<DraftPool | null> {
  const { data, error } = await supabase
    .from('draft_pools')
    .select('*')
    .eq('season_id', seasonId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? toDraftPool(data) : null;
}

/**
 * Every pool of a season in creation order (oldest first), as the draft-room
 * page's `selectPool` and the admin pool list (route #2) take them. Narrow
 * columns only.
 */
export async function getDraftPoolsBySeason(seasonId: string): Promise<AdminPoolSummary[]> {
  const { data, error } = await supabase
    .from('draft_pools')
    .select('id, engine, kind, phase, mode, status')
    .eq('season_id', seasonId)
    .order('created_at', { ascending: true });

  if (error) {
    // Deploy-before-migrate guard: without the M2 columns (engine/kind/phase/mode)
    // PostgREST answers 42703 / PGRST204. The league pages then show no pool
    // list instead of a 500 (README "Release order": migrate first).
    if (isMissingColumnError(error)) {
      console.error('[queries/drafts] draft_pools lacks the queue-engine columns; apply the 20261010* migrations:', error);
      return [];
    }
    throw error;
  }
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
 * Legacy pools: only while pending. Queue-engine pools: only in phase
 * `setup` or `cancelled` (design decision); `draft_cancel` writes
 * status 'complete' with phase 'cancelled', so the phase decides, not the status.
 */
export async function deleteDraftPool(id: string): Promise<void> {
  const pool = await getDraftPoolById(id);
  if (!pool) throw new Error('Draft pool not found');
  if (pool.engine === 'queue') {
    if (pool.phase !== 'setup' && pool.phase !== 'cancelled') {
      throw new Error('Can only delete queue draft pools in setup or cancelled phase');
    }
  } else if (pool.status !== 'pending') {
    throw new Error('Can only delete draft pools in pending status');
  }

  const { error } = await supabase
    .from('draft_pools')
    .delete()
    .eq('id', id);

  if (error) throw error;
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

export async function getPicksByPlayer(
  poolId: string,
  playerId: string
): Promise<DraftPick[]> {
  const { data, error } = await supabase
    .from('draft_picks')
    .select('*')
    .eq('draft_pool_id', poolId)
    .eq('player_id', playerId)
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
