/**
 * Draft Kill Token purchases (EvoLiga Prompt 6/7; draft-backend BR-4, §6.9).
 * One token per request through `epb_purchase_draft_token` (M7), which
 * re-checks every rule under the season lock; the ledger
 * `epb_draft_token_purchases` is append-only and its points never come back.
 */

import { supabase } from '../client';
import type { Json, Tables } from '@/types/database';

type PurchaseRow = Tables<'epb_draft_token_purchases'>;

export interface DraftTokenPurchase {
  id: string;
  season_id: string;
  player_id: string;
  line_id: string;
  /** Null once the line's tracker was deleted (the purchase stays spent). */
  tracker_id: string | null;
  points_spent: number;
  client_request_id: string;
  created_by: string | null;
  created_at: string;
}

function toPurchase(row: PurchaseRow): DraftTokenPurchase {
  return {
    id: row.id,
    season_id: row.season_id,
    player_id: row.player_id,
    line_id: row.line_id,
    tracker_id: row.tracker_id,
    points_spent: row.points_spent,
    client_request_id: row.client_request_id,
    created_by: row.created_by,
    created_at: row.created_at,
  };
}

/** Every Draft Kill Token purchase of a season (optionally one player's), oldest first. */
export async function getDraftTokenPurchases(
  seasonId: string,
  playerId?: string
): Promise<DraftTokenPurchase[]> {
  let query = supabase
    .from('epb_draft_token_purchases')
    .select('*')
    .eq('season_id', seasonId)
    .order('created_at', { ascending: true });
  if (playerId) query = query.eq('player_id', playerId);

  const { data, error } = await query;
  if (error) throw error;
  return data.map(toPurchase);
}

/** `epb_purchase_draft_token` result. A replay returns the first purchase without `progress` / `remaining_points`. */
export interface DraftTokenPurchaseResult {
  purchase_id: string;
  tracker_id: string | null;
  line_id: string;
  points_spent: number;
  progress?: number;
  remaining_points?: number;
  replay: boolean;
}

function isRecord(value: Json): value is { [key: string]: Json | undefined } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toPurchaseResult(data: Json): DraftTokenPurchaseResult {
  if (!isRecord(data) || typeof data.purchase_id !== 'string' || typeof data.line_id !== 'string') {
    throw new Error('epb_purchase_draft_token returned an unexpected payload');
  }
  return {
    purchase_id: data.purchase_id,
    tracker_id: typeof data.tracker_id === 'string' ? data.tracker_id : null,
    line_id: data.line_id,
    points_spent: typeof data.points_spent === 'number' ? data.points_spent : 0,
    ...(typeof data.progress === 'number' ? { progress: data.progress } : {}),
    ...(typeof data.remaining_points === 'number' ? { remaining_points: data.remaining_points } : {}),
    replay: data.replay === true,
  };
}

/**
 * Buy one Draft Kill Token for a line (RPC). `nextThreshold` is the line's next
 * cumulative threshold from TS (`nextThresholdFor(effectiveThresholds(entry), stage)`,
 * null when fully evolved); the RPC refuses a purchase that would trigger an
 * evolution. Rule refusals arrive as PostgREST errors (P0001, message = the
 * `errors/draft` code, DETAIL = params); the caller maps them (`rpc-errors.ts`).
 */
export async function purchaseDraftTokenRpc(input: {
  seasonId: string;
  playerId: string;
  actorId: string;
  lineId: string;
  nextThreshold: number | null;
  clientRequestId: string;
}): Promise<DraftTokenPurchaseResult> {
  const { data, error } = await supabase.rpc('epb_purchase_draft_token', {
    p_season_id: input.seasonId,
    p_player_id: input.playerId,
    p_actor_id: input.actorId,
    p_line_id: input.lineId,
    // NULL is meaningful (the RPC answers LINE_FULLY_EVOLVED in its refusal order), but generated Args type a
    // non-default parameter as non-null.
    p_next_threshold: input.nextThreshold as number,
    p_client_request_id: input.clientRequestId,
  });

  if (error) throw error;
  return toPurchaseResult(data);
}
