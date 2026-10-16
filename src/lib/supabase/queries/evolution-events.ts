import { supabase } from '../client';
import type { Tables, TablesInsert } from '@/types/database';
import type { EvolutionEvent, EvolutionEventRecord } from '@/types/evolution';

type EventRow = Tables<'evolution_events'>;

function toEventRecord(row: EventRow): EvolutionEventRecord {
  return {
    id: row.id,
    season_id: row.season_id,
    matchday: row.matchday,
    tracker_id: row.tracker_id,
    player_id: row.player_id,
    base_pokemon: row.base_pokemon,
    previous_form: row.previous_form,
    new_form: row.new_form,
    previous_stage: row.previous_stage,
    new_stage: row.new_stage,
    total_kos: row.total_kos ?? 0,
    is_devolution: row.is_devolution,
    is_manual: row.is_manual,
    created_at: row.created_at,
  };
}

export interface EvolutionEventContext {
  season_id: string;
  matchday?: number | null;
  is_manual?: boolean;
}

/**
 * Persist development events (stage transitions) for the EPB format.
 * Called by the match evaluator right after events are computed, and by
 * the admin progress-correction route (with is_manual = true).
 */
export async function insertEvolutionEvents(
  events: EvolutionEvent[],
  ctx: EvolutionEventContext
): Promise<void> {
  if (events.length === 0) return;

  const rows: TablesInsert<'evolution_events'>[] = events.map((e) => ({
    season_id: ctx.season_id,
    matchday: ctx.matchday ?? null,
    tracker_id: e.tracker_id ?? null,
    player_id: e.player_id,
    base_pokemon: e.base_pokemon,
    previous_form: e.previous_form,
    new_form: e.new_form,
    previous_stage: e.previous_stage ?? null,
    new_stage: e.new_stage,
    total_kos: e.total_kos,
    is_devolution: e.is_devolution,
    is_manual: ctx.is_manual ?? false,
  }));

  const { error } = await supabase.from('evolution_events').insert(rows);
  if (error) throw error;
}

/**
 * Get persisted development events for a season, optionally scoped to one
 * matchday (used by match finalize to award evolution points).
 */
export async function getSeasonEvolutionEvents(
  seasonId: string,
  matchday?: number
): Promise<EvolutionEventRecord[]> {
  let query = supabase
    .from('evolution_events')
    .select('*')
    .eq('season_id', seasonId)
    .order('created_at', { ascending: true });

  if (matchday !== undefined) {
    query = query.eq('matchday', matchday);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data.map(toEventRecord);
}
