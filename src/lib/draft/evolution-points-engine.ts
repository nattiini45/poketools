/**
 * Evolution-point accounting for EPB seasons.
 * Points are tabular tiebreakers — max 1 per player per matchday.
 */

import {
  getSeasonTrackers,
} from '@/lib/supabase/queries/evolutions';
import { insertProgressLog } from '@/lib/supabase/queries/progress-log';
import { supabase } from '@/lib/supabase/client';

export const EVOLUTION_POINT_LOG_NOTE = 'evolution_point_awarded';

/** True when this player already received an evolution point on the matchday. */
export async function hasEvolutionPointForMatchday(
  seasonId: string,
  playerId: string,
  matchday: number
): Promise<boolean> {
  const trackers = await getSeasonTrackers(seasonId);
  const trackerIds = trackers
    .filter((tracker) => tracker.player_id === playerId)
    .map((tracker) => tracker.id);

  if (trackerIds.length === 0) return false;

  const { data, error } = await supabase
    .from('evo_progress_log')
    .select('id')
    .eq('season_id', seasonId)
    .eq('matchday', matchday)
    .eq('note', EVOLUTION_POINT_LOG_NOTE)
    .in('tracker_id', trackerIds)
    .limit(1);

  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/**
 * Award an evolution point when the player evolved this matchday.
 * Deduped per (player, matchday) via evo_progress_log audit rows.
 */
export async function awardEvolutionPointForMatchday(
  seasonId: string,
  playerId: string,
  matchday: number,
  evolvedThisMatchday: boolean
): Promise<boolean> {
  if (!evolvedThisMatchday) return false;

  if (await hasEvolutionPointForMatchday(seasonId, playerId, matchday)) {
    return false;
  }

  const trackers = await getSeasonTrackers(seasonId);
  const playerTrackers = trackers
    .filter((tracker) => tracker.player_id === playerId)
    .sort((a, b) => a.base_pokemon.localeCompare(b.base_pokemon));

  if (playerTrackers.length === 0) return false;

  const carrier = playerTrackers[0];
  const { error } = await supabase.rpc('increment_evolution_points', {
    p_tracker_id: carrier.id,
    p_amount: 1,
  });
  if (error) throw error;

  await insertProgressLog({
    tracker_id: carrier.id,
    season_id: seasonId,
    matchday,
    source: 'admin_correction',
    amount: 1,
    note: EVOLUTION_POINT_LOG_NOTE,
  });

  return true;
}

export interface RecalculateEvolutionPointsResult {
  players_updated: number;
  points_awarded: number;
}

/**
 * Rebuild evolution_points_awarded from persisted development events in one
 * transactional RPC (wipe + recompute).
 */
export async function recalculateEvolutionPoints(
  seasonId: string
): Promise<RecalculateEvolutionPointsResult> {
  const { data, error } = await supabase.rpc('epb_recalculate_evolution_points', {
    p_season_id: seasonId,
  });
  if (error) throw error;

  const result = data as { players_updated?: number; points_awarded?: number } | null;
  return {
    players_updated: result?.players_updated ?? 0,
    points_awarded: result?.points_awarded ?? 0,
  };
}
