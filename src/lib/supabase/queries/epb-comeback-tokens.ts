/**
 * Comeback Token spends.
 * Balance = earned (computed in TS from completed matches) − Σ spends (in tokens; no legacy
 * grant stock: no carried-over comeback stock); the `epb_spend_comeback_tokens` RPC (latest definition in
 * 20261018140000_epb_comeback_rules.sql) re-checks the balance under the season lock and
 * converts each line's tokens to progress at its per-line comeback rate. Spends are append-only.
 */

import { supabase } from '../client';
import type { Json, Tables } from '@/types/database';

type SpendRow = Tables<'epb_comeback_token_spends'>;

export interface ComebackTokenSpend {
  id: string;
  season_id: string;
  player_id: string;
  line_id: string;
  /** Null once the line's tracker was deleted. */
  tracker_id: string | null;
  amount: number;
  client_request_id: string;
  created_by: string | null;
  created_at: string;
}

function toSpend(row: SpendRow): ComebackTokenSpend {
  return {
    id: row.id,
    season_id: row.season_id,
    player_id: row.player_id,
    line_id: row.line_id,
    tracker_id: row.tracker_id,
    amount: row.amount,
    client_request_id: row.client_request_id,
    created_by: row.created_by,
    created_at: row.created_at,
  };
}

/** Every Comeback Token spend of a season (optionally one player's), oldest first. */
export async function getComebackTokenSpends(
  seasonId: string,
  playerId?: string
): Promise<ComebackTokenSpend[]> {
  let query = supabase
    .from('epb_comeback_token_spends')
    .select('*')
    .eq('season_id', seasonId)
    .order('created_at', { ascending: true });
  if (playerId) query = query.eq('player_id', playerId);

  const { data, error } = await query;
  if (error) throw error;
  return data.map(toSpend);
}

/** One line's share of a spend request. */
export interface ComebackAllocation {
  line_id: string;
  /** 1–20 tokens on this line. */
  count: number;
}

/**
 * An allocation with its line's server-side rate: `ratio` Comeback Tokens buy 1 progress point
 * (`comebackTokensPerProgressOf`; 1 on every line but a participation line). Never client input.
 */
export interface PricedComebackAllocation extends ComebackAllocation {
  /** 1–10; `count` must be a multiple of it. */
  ratio: number;
}

/** `epb_spend_comeback_tokens` result. A replay carries no `tracker_ids`. */
export interface ComebackSpendResult {
  spent: number;
  balance_after: number;
  tracker_ids: string[];
  replay: boolean;
}

function isRecord(value: Json): value is { [key: string]: Json | undefined } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toSpendResult(data: Json): ComebackSpendResult {
  if (!isRecord(data) || typeof data.spent !== 'number') {
    throw new Error('epb_spend_comeback_tokens returned an unexpected payload');
  }
  const ids = Array.isArray(data.tracker_ids) ? data.tracker_ids : [];
  return {
    spent: data.spent,
    balance_after: typeof data.balance_after === 'number' ? data.balance_after : 0,
    tracker_ids: ids.filter((id): id is string => typeof id === 'string'),
    replay: data.replay === true,
  };
}

/**
 * Spend Comeback Tokens on owned lines (RPC). `earnedTotal` is the player's
 * season total from `computeEarnedComebackTokens`; a stale value can only
 * under-allow (spends are append-only). Rule refusals arrive as PostgREST
 * errors (P0001 + `errors/draft` code); the caller maps them (`rpc-errors.ts`).
 */
export async function spendComebackTokensRpc(input: {
  seasonId: string;
  playerId: string;
  actorId: string;
  earnedTotal: number;
  allocations: readonly PricedComebackAllocation[];
  clientRequestId: string;
}): Promise<ComebackSpendResult> {
  const allocations: Json = input.allocations.map((a) => ({ line_id: a.line_id, count: a.count, ratio: a.ratio }));
  const { data, error } = await supabase.rpc('epb_spend_comeback_tokens', {
    p_season_id: input.seasonId,
    p_player_id: input.playerId,
    p_actor_id: input.actorId,
    p_earned_total: input.earnedTotal,
    p_allocations: allocations,
    p_client_request_id: input.clientRequestId,
  });

  if (error) throw error;
  return toSpendResult(data);
}
