import { supabase } from '../client';
import type { Tables, TablesInsert } from '@/types/database';
import type {
  EvolutionTier,
  EvolutionTierFormData,
  EvolutionTracker,
  EvolutionTrackerWithTier,
} from '@/types/evolution';

type TierRow = Tables<'evolution_tiers'>;
type TrackerRow = Tables<'evolution_tracker'>;

function toTier(row: TierRow): EvolutionTier {
  return {
    id: row.id,
    season_id: row.season_id,
    player_id: row.player_id,
    base_pokemon: row.base_pokemon,
    stage2_pokemon: row.stage2_pokemon,
    stage2_kos: row.stage2_kos,
    stage3_pokemon: row.stage3_pokemon,
    stage3_kos: row.stage3_kos,
    power_tier: (row.power_tier ?? 'C') as EvolutionTier['power_tier'],
    created_at: row.created_at,
  };
}

function toTracker(row: TrackerRow): EvolutionTracker {
  return {
    id: row.id,
    season_id: row.season_id,
    player_id: row.player_id,
    base_pokemon: row.base_pokemon,
    current_form: row.current_form,
    total_kos: row.total_kos,
    current_stage: row.current_stage,
    evolved_at: row.evolved_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    real_kills: row.real_kills,
    draft_tokens: row.draft_tokens,
    kill_tokens: row.kill_tokens,
    cosmo_points: row.cosmo_points,
    suspended_until_matchday: row.suspended_until_matchday,
    evolution_points_awarded: row.evolution_points_awarded,
    locked_stage3_pokemon: row.locked_stage3_pokemon,
    line_id: row.line_id,
    transferred_evo_progress: row.transferred_evo_progress,
    redraft_slot_id: row.redraft_slot_id,
  };
}

// ─── Evolution Tiers (Admin CRUD) ──────────────────────────────────

/** Get a single evolution tier by ID. */
export async function getTierById(id: string): Promise<EvolutionTier | null> {
  const { data, error } = await supabase
    .from('evolution_tiers')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data ? toTier(data) : null;
}

/** Get all tier list entries for a season (excludes wildcards). */
export async function getTierList(seasonId: string): Promise<EvolutionTier[]> {
  const { data, error } = await supabase
    .from('evolution_tiers')
    .select('*')
    .eq('season_id', seasonId)
    .is('player_id', null)
    .order('base_pokemon');

  if (error) throw error;
  return data.map(toTier);
}

/** Get all wildcard entries for a season (player-assigned). */
export async function getWildcards(seasonId: string): Promise<EvolutionTier[]> {
  const { data, error } = await supabase
    .from('evolution_tiers')
    .select('*')
    .eq('season_id', seasonId)
    .not('player_id', 'is', null)
    .order('base_pokemon');

  if (error) throw error;
  return data.map(toTier);
}

/** Get wildcards assigned to a specific player. */
export async function getPlayerWildcards(
  seasonId: string,
  playerId: string
): Promise<EvolutionTier[]> {
  const { data, error } = await supabase
    .from('evolution_tiers')
    .select('*')
    .eq('season_id', seasonId)
    .eq('player_id', playerId)
    .order('base_pokemon');

  if (error) throw error;
  return data.map(toTier);
}

/** Get all tiers + wildcards for a season (full picture). */
export async function getAllTiers(seasonId: string): Promise<EvolutionTier[]> {
  const { data, error } = await supabase
    .from('evolution_tiers')
    .select('*')
    .eq('season_id', seasonId)
    .order('base_pokemon');

  if (error) throw error;
  return data.map(toTier);
}

/** Find the tier for a specific base Pokémon (tier list or player wildcard). */
export async function getTierByBasePokemon(
  seasonId: string,
  basePokemon: string,
  playerId?: string | null
): Promise<EvolutionTier | null> {
  let query = supabase
    .from('evolution_tiers')
    .select('*')
    .eq('season_id', seasonId)
    .eq('base_pokemon', basePokemon);

  if (playerId) {
    query = query.eq('player_id', playerId);
  } else {
    query = query.is('player_id', null);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data ? toTier(data) : null;
}

export async function createTier(input: EvolutionTierFormData): Promise<EvolutionTier> {
  const insert: TablesInsert<'evolution_tiers'> = {
    season_id: input.season_id,
    player_id: input.player_id ?? null,
    base_pokemon: input.base_pokemon,
    stage2_pokemon: input.stage2_pokemon,
    stage2_kos: input.stage2_kos,
    stage3_pokemon: input.stage3_pokemon ?? null,
    stage3_kos: input.stage3_kos ?? null,
    power_tier: input.power_tier ?? 'C',
  };

  const { data, error } = await supabase
    .from('evolution_tiers')
    .insert(insert)
    .select()
    .single();

  if (error) throw error;
  return toTier(data);
}

export async function updateTier(
  id: string,
  updates: Partial<Pick<EvolutionTierFormData, 'stage2_kos' | 'stage3_kos' | 'power_tier'>>
): Promise<EvolutionTier> {
  const { data, error } = await supabase
    .from('evolution_tiers')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return toTier(data);
}

export async function deleteTier(id: string): Promise<void> {
  const { error } = await supabase
    .from('evolution_tiers')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

/** Bulk-create tier list entries from an array. */
export async function bulkCreateTiers(
  tiers: EvolutionTierFormData[]
): Promise<EvolutionTier[]> {
  const inserts: TablesInsert<'evolution_tiers'>[] = tiers.map((t) => ({
    season_id: t.season_id,
    player_id: t.player_id ?? null,
    base_pokemon: t.base_pokemon,
    stage2_pokemon: t.stage2_pokemon,
    stage2_kos: t.stage2_kos,
    stage3_pokemon: t.stage3_pokemon ?? null,
    stage3_kos: t.stage3_kos ?? null,
    power_tier: t.power_tier ?? 'C',
  }));

  const { data, error } = await supabase
    .from('evolution_tiers')
    .insert(inserts)
    .select();

  if (error) throw error;
  return data.map(toTier);
}

// ─── Evolution Tracker ─────────────────────────────────────────────

/** Get all trackers for a season (all players). */
export async function getSeasonTrackers(
  seasonId: string
): Promise<EvolutionTracker[]> {
  const { data, error } = await supabase
    .from('evolution_tracker')
    .select('*')
    .eq('season_id', seasonId)
    .order('player_id')
    .order('base_pokemon');

  if (error) throw error;
  return data.map(toTracker);
}

/** Get a player's trackers for a season. */
export async function getPlayerTrackers(
  seasonId: string,
  playerId: string
): Promise<EvolutionTracker[]> {
  const { data, error } = await supabase
    .from('evolution_tracker')
    .select('*')
    .eq('season_id', seasonId)
    .eq('player_id', playerId)
    .order('base_pokemon');

  if (error) throw error;
  return data.map(toTracker);
}

/** Get trackers enriched with their tier definitions. */
export async function getPlayerTrackersWithTiers(
  seasonId: string,
  playerId: string
): Promise<EvolutionTrackerWithTier[]> {
  const [trackers, allTiers] = await Promise.all([
    getPlayerTrackers(seasonId, playerId),
    getAllTiers(seasonId),
  ]);

  return trackers.map((tracker) => {
    // Match tier: check player-specific wildcard first, then general tier list
    const tier =
      allTiers.find(
        (t) => t.base_pokemon === tracker.base_pokemon && t.player_id === playerId
      ) ??
      allTiers.find(
        (t) => t.base_pokemon === tracker.base_pokemon && t.player_id === null
      );

    if (!tier) {
      throw new Error(
        `No evolution tier found for ${tracker.base_pokemon} in season ${seasonId}`
      );
    }

    return { ...tracker, tier };
  });
}

/** Create a tracker when a player drafts a base-form or is assigned a wildcard. */
export async function createTracker(input: {
  season_id: string;
  player_id: string;
  base_pokemon: string;
  current_form?: string;
  current_stage?: number;
  total_kos?: number;
  real_kills?: number;
  evolution_points_awarded?: number;
  locked_stage3_pokemon?: string | null;
  /** Draft line id (one tracker per line per season); null for legacy evolution-tier leagues. */
  line_id?: string | null;
  /** Spec `transferred_evo_progress`: evolution progress only, never shown as kills. */
  transferred_evo_progress?: number;
  redraft_slot_id?: string | null;
}): Promise<EvolutionTracker> {
  const insert: TablesInsert<'evolution_tracker'> = {
    season_id: input.season_id,
    player_id: input.player_id,
    base_pokemon: input.base_pokemon,
    current_form: input.current_form ?? input.base_pokemon,
    total_kos: input.total_kos ?? 0,
    current_stage: input.current_stage ?? 1,
    real_kills: input.real_kills ?? 0,
    evolution_points_awarded: input.evolution_points_awarded ?? 0,
    locked_stage3_pokemon: input.locked_stage3_pokemon ?? null,
    line_id: input.line_id ?? null,
    transferred_evo_progress: input.transferred_evo_progress ?? 0,
    redraft_slot_id: input.redraft_slot_id ?? null,
  };

  const { data, error } = await supabase
    .from('evolution_tracker')
    .insert(insert)
    .select()
    .single();

  if (error) throw error;
  return toTracker(data);
}

/** Update a tracker's evolution state. */
export async function updateTracker(
  id: string,
  updates: {
    current_form?: string;
    total_kos?: number;
    current_stage?: number;
    evolved_at?: string | null;
    real_kills?: number;
    draft_tokens?: number;
    kill_tokens?: number;
    cosmo_points?: number;
    suspended_until_matchday?: number | null;
    evolution_points_awarded?: number;
    locked_stage3_pokemon?: string | null;
  }
): Promise<EvolutionTracker> {
  const { data, error } = await supabase
    .from('evolution_tracker')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return toTracker(data);
}

/** Delete the tracker of one draft line (e.g. when a draft pick is undone). */
export async function deleteTrackerByLine(
  seasonId: string,
  playerId: string,
  lineId: string
): Promise<void> {
  const { error } = await supabase
    .from('evolution_tracker')
    .delete()
    .eq('season_id', seasonId)
    .eq('player_id', playerId)
    .eq('line_id', lineId);

  if (error) throw error;
}

/**
 * Delete one tracker by its id. The undo route uses it for a legacy pick
 * without a line id: it resolves the exact tracker first, so a base-keyed
 * delete (which could hit both branches of one base) is never needed.
 */
export async function deleteTrackerById(trackerId: string): Promise<void> {
  const { error } = await supabase
    .from('evolution_tracker')
    .delete()
    .eq('id', trackerId);

  if (error) throw error;
}

// ─── KO Counting (for evolution checks) ────────────────────────────

/**
 * Sum all KOs dealt by a player's Pokémon across all forms in a season.
 *
 * This queries battle_stats joined through games → matches → tournaments → seasons.
 * It looks for KOs under ALL forms (base, stage2, stage3) since the Pokémon
 * may have been used under different names as it evolved.
 *
 * NOTE: This is a targeted read of battle_stats for evolution checking only.
 * It does NOT replace the aggregates table for stats display (CLAUDE.md rule #4).
 */
export async function getSeasonKosForLine(
  seasonId: string,
  playerId: string,
  formNames: string[]
): Promise<number> {
  // Get all tournament IDs in this season
  const { data: tournaments, error: tErr } = await supabase
    .from('tournaments')
    .select('id')
    .eq('season_id', seasonId);

  if (tErr) throw tErr;
  if (!tournaments || tournaments.length === 0) return 0;

  const tournamentIds = tournaments.map((t) => t.id);

  // Get all match IDs in those tournaments
  const { data: matches, error: mErr } = await supabase
    .from('matches')
    .select('id')
    .in('tournament_id', tournamentIds);

  if (mErr) throw mErr;
  if (!matches || matches.length === 0) return 0;

  const matchIds = matches.map((m) => m.id);

  // Get all game IDs in those matches
  const { data: games, error: gErr } = await supabase
    .from('games')
    .select('id')
    .in('match_id', matchIds);

  if (gErr) throw gErr;
  if (!games || games.length === 0) return 0;

  const gameIds = games.map((g) => g.id);

  // Sum KOs for this player across all forms in those games
  const { data: stats, error: sErr } = await supabase
    .from('battle_stats')
    .select('kos_dealt')
    .eq('player_id', playerId)
    .in('game_id', gameIds)
    .in('pokemon_name', formNames);

  if (sErr) throw sErr;
  if (!stats || stats.length === 0) return 0;

  return stats.reduce((sum, s) => sum + s.kos_dealt, 0);
}

// ─── Progress Source Updates (evolution_point_buy format) ────────

/**
 * Atomically increment a progress source column and total_kos on a tracker.
 * Used by the progress engine to apply kills, tokens, and participation tokens.
 * Columns are clamped at 0 (negative admin corrections cannot underflow).
 *
 * Delegates to the increment_tracker_progress RPC — a single UPDATE statement —
 * so concurrent callers cannot lose updates (no read-modify-write race).
 * Returns the updated tracker so callers can resolve stage transitions from
 * the post-update values.
 */
export async function updateTrackerProgress(
  trackerId: string,
  source: 'real_kills' | 'draft_tokens' | 'kill_tokens' | 'cosmo_points' | 'transferred_evo_progress',
  amount: number
): Promise<EvolutionTracker> {
  const { data, error } = await supabase.rpc('increment_tracker_progress', {
    p_tracker_id: trackerId,
    p_source: source,
    p_amount: amount,
  });

  if (error) throw error;
  return toTracker(data);
}

/**
 * Atomically increment a progress source AND insert the evo_progress_log
 * audit row in one transaction (epb_apply_progress RPC). Source uses the
 * log vocabulary; the tracker column is derived inside the function.
 * Returns the post-update tracker.
 */
export async function applyTrackerProgressWithLog(
  trackerId: string,
  source: 'real_kill' | 'draft_token' | 'kill_token' | 'cosmo_point' | 'transferred',
  amount: number,
  opts: { matchday?: number | null; note?: string | null; createdBy?: string | null } = {}
): Promise<EvolutionTracker> {
  const { data, error } = await supabase.rpc('epb_apply_progress', {
    p_tracker_id: trackerId,
    p_source: source,
    p_amount: amount,
    // omitted = the SQL defaults (NULL); generated Args type defaulted parameters as optional, not nullable
    p_matchday: opts.matchday ?? undefined,
    p_note: opts.note ?? undefined,
    p_created_by: opts.createdBy ?? undefined,
  });

  if (error) throw error;
  return toTracker(data);
}

/**
 * Atomically increment the evolution-point counter on a tracker
 * (player-level counter stored on one of the player's trackers).
 */
export async function incrementEvolutionPoints(
  trackerId: string,
  amount = 1
): Promise<void> {
  const { error } = await supabase.rpc('increment_evolution_points', {
    p_tracker_id: trackerId,
    p_amount: amount,
  });

  if (error) throw error;
}

/** Get a tracker by its ID. */
export async function getTrackerById(id: string): Promise<EvolutionTracker | null> {
  const { data, error } = await supabase
    .from('evolution_tracker')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data ? toTracker(data) : null;
}

/**
 * Clear served early-stage-3 suspensions: a suspension for matchday N
 * (suspended_until_matchday = N) is over once a later matchday is being
 * evaluated. Single UPDATE, idempotent.
 */
export async function clearExpiredSuspensions(
  seasonId: string,
  currentMatchday: number
): Promise<void> {
  const { error } = await supabase
    .from('evolution_tracker')
    .update({ suspended_until_matchday: null })
    .eq('season_id', seasonId)
    .not('suspended_until_matchday', 'is', null)
    .lt('suspended_until_matchday', currentMatchday);

  if (error) throw error;
}

/**
 * Sum evolution points per player for a season (player-level counters are
 * carried on tracker rows). One grouped query — feeds the EPB standings
 * tiebreaker.
 */
export async function getSeasonEvolutionPoints(
  seasonId: string
): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from('evolution_tracker')
    .select('player_id, evolution_points_awarded')
    .eq('season_id', seasonId);

  if (error) throw error;

  const totals: Record<string, number> = {};
  for (const row of data) {
    totals[row.player_id] = (totals[row.player_id] ?? 0) + row.evolution_points_awarded;
  }
  return totals;
}

/** Get a player's tracker of one draft line (`evolution_tracker.line_id`). */
export async function getTrackerByLine(
  seasonId: string,
  playerId: string,
  lineId: string
): Promise<EvolutionTracker | null> {
  const { data, error } = await supabase
    .from('evolution_tracker')
    .select('*')
    .eq('season_id', seasonId)
    .eq('player_id', playerId)
    .eq('line_id', lineId)
    .maybeSingle();

  if (error) throw error;
  return data ? toTracker(data) : null;
}

/**
 * LEGACY FALLBACK: a tracker by season, player and base Pokémon, for legacy
 * evolution-tier leagues only (their trackers have no line id; one line per
 * base there). Branch-unsafe for point-buy lines, where a player may own both
 * branches of one base: those always go through `getTrackerByLine`.
 */
export async function getLegacyTrackerByBase(
  seasonId: string,
  playerId: string,
  basePokemon: string
): Promise<EvolutionTracker | null> {
  const { data, error } = await supabase
    .from('evolution_tracker')
    .select('*')
    .eq('season_id', seasonId)
    .eq('player_id', playerId)
    .eq('base_pokemon', basePokemon)
    .maybeSingle();

  if (error) throw error;
  return data ? toTracker(data) : null;
}
