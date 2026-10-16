import { supabase } from '../client';
import type { Tables } from '@/types/database';
import type { RedraftHistoryEntry } from '@/types/evolution';

type RedraftRow = Tables<'redraft_history'>;

function toEntry(row: RedraftRow): RedraftHistoryEntry {
  return {
    id: row.id,
    season_id: row.season_id,
    player_id: row.player_id,
    from_tracker_id: row.from_tracker_id,
    to_base_pokemon: row.to_base_pokemon,
    to_stage3_pokemon: row.to_stage3_pokemon,
    transfer_type: row.transfer_type as RedraftHistoryEntry['transfer_type'],
    trade_partner_id: row.trade_partner_id,
    missing_kills_transferred: row.missing_kills_transferred,
    points_spent: row.points_spent,
    created_at: row.created_at,
    draft_pool_id: row.draft_pool_id,
    dropped_line_id: row.dropped_line_id,
    transferred_real_kills: row.transferred_real_kills,
    points_refunded: row.points_refunded,
  };
}

/** Get all redraft history for a season, newest first. */
export async function getRedraftHistory(seasonId: string): Promise<RedraftHistoryEntry[]> {
  const { data, error } = await supabase
    .from('redraft_history')
    .select('*')
    .eq('season_id', seasonId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data.map(toEntry);
}

/** Get redraft history for a specific player in a season. */
export async function getPlayerRedraftHistory(
  seasonId: string,
  playerId: string
): Promise<RedraftHistoryEntry[]> {
  const { data, error } = await supabase
    .from('redraft_history')
    .select('*')
    .eq('season_id', seasonId)
    .eq('player_id', playerId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data.map(toEntry);
}

// ─── Trade swap payload ─────────────────────────────────────

/** One side of a consented trade, executed by `epb_execute_trade_request` (redraft-trade-requests.ts). */
export interface RedraftSwapPayload {
  player_id: string;
  from_tracker_id: string;
  new_tracker: {
    base_pokemon: string;
    current_form: string;
    current_stage: number;
    total_kos: number;
    /** Match-earned kills of the NEW line: always 0 on a trade (transferred progress is not a kill). */
    real_kills: number;
    /** Spec `transferred_evo_progress` (draft-backend §6.10): the carried-over progress, in its own column. */
    transferred_evo_progress: number;
    /** Target line id (`lineIdOfEntry` of the target list entry). */
    line_id: string;
    evolution_points_awarded: number;
    locked_stage3_pokemon: string | null;
  };
  history: {
    to_base_pokemon: string;
    to_stage3_pokemon: string | null;
    transfer_type: 'trade';
    trade_partner_id: string | null;
    missing_kills_transferred: number;
    points_spent: number;
  };
}

// ─── Redraft slots (secret drop, migration M3) ──────────────

/** One published drop's refund: the dropped line's price returns to the player's season budget. */
export interface RedraftSlotRefund {
  player_id: string;
  draft_pool_id: string;
  dropped_price: number;
}

/** The season's redraft-slot refunds (all players, all redraft pools). Narrow columns only. */
export async function getRedraftSlotRefunds(seasonId: string): Promise<RedraftSlotRefund[]> {
  const { data, error } = await supabase
    .from('redraft_slots')
    .select('player_id, draft_pool_id, dropped_price')
    .eq('season_id', seasonId);

  if (error) throw error;
  return data.map((row) => ({
    player_id: row.player_id,
    draft_pool_id: row.draft_pool_id,
    dropped_price: row.dropped_price,
  }));
}
