import { supabase } from '../client';
import type { RedraftSwapPayload } from './redraft';
import type { Tables, TablesInsert, TablesUpdate, Json } from '@/types/database';
import type { ApiErrorCode } from '@/i18n/messages/errors';

type TradeRequestRow = Tables<'redraft_trade_requests'>;

const SOURCE_TRACKER_MISSING = /^Source tracker .+ not found for this player in this season$/;
const LINE_ALREADY_OWNED = /^Line (.+) is already owned by another player$/;

/** The `errors/draft-legacy` code (and params) of one `epb_execute_trade_request` refusal. */
export interface TradeRpcRejection {
  code: ApiErrorCode;
  params?: Readonly<Record<string, string | number>>;
}

/**
 * Map a reason the trade RPC (`epb_execute_trade_request`) RAISEs to its
 * `errors/draft-legacy` code (and params). The RPC raises plain message
 * texts, not codes, so this is the one place that matches them; anything
 * unknown becomes `trade_execution_rejected {reason}`.
 */
export function tradeRpcRejection(message: string): TradeRpcRejection {
  switch (message) {
    case 'Trade request not found':
      return { code: 'trade_request_not_found' };
    case 'request_not_executable':
      return { code: 'trade_request_not_executable' };
    case 'phase_closed':
      return { code: 'redraft_phase_not_open' };
    case 'multiple_draft_pools':
      return { code: 'trade_multiple_draft_pools' };
    case 'insufficient_points':
      return { code: 'trade_insufficient_points' };
  }
  if (SOURCE_TRACKER_MISSING.test(message)) return { code: 'trade_source_tracker_unavailable' };
  const owned = LINE_ALREADY_OWNED.exec(message);
  if (owned) return { code: 'trade_line_already_owned', params: { pokemon: owned[1] } };
  return { code: 'trade_execution_rejected', params: { reason: message } };
}

/**
 * Typed error raised by `executeTradeRequest` when the
 * `epb_execute_trade_request` RPC aborts the transaction with a plpgsql
 * `RAISE EXCEPTION ... ERRCODE = 'P0001'`. The route surfaces these as 409
 * (request stays pending — the RPC's transaction rolled back automatically, so
 * no TS revert is needed). `message` is the RPC's failure reason
 * (request_not_executable / phase_closed / insufficient_points / free-line /
 * ownership); `rpcCode` is the Postgres SQLSTATE carried on the raw error;
 * `code` / `params` are the API error code for it (`tradeRpcRejection`).
 */
export class TradeRequestExecutionError extends Error {
  readonly rpcCode: string;
  readonly code: ApiErrorCode;
  readonly params?: Readonly<Record<string, string | number>>;
  constructor(message: string, rpcCode: string) {
    super(message);
    this.name = 'TradeRequestExecutionError';
    this.rpcCode = rpcCode;
    const rejection = tradeRpcRejection(message);
    this.code = rejection.code;
    if (rejection.params !== undefined) this.params = rejection.params;
  }
}

/**
 * Plain shape of a `redraft_trade_requests` row. Kept Zod-free so it can be
 * shared between API routes and tests without pulling the validation layer.
 * `executed_tracker_ids` is the raw jsonb (the new tracker ids returned by the
 * `epb_execute_redraft` RPC, for audit).
 */
export interface TradeRequest {
  id: string;
  season_id: string;
  initiated_by: string;
  player_a_id: string;
  from_tracker_a_id: string | null;
  line_a: string;
  player_b_id: string;
  from_tracker_b_id: string | null;
  line_b: string;
  status: 'pending' | 'executed' | 'cancelled';
  consent_a: boolean;
  consent_b: boolean;
  created_at: string;
  executed_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  executed_tracker_ids: Json | null;
}

function toTradeRequest(row: TradeRequestRow): TradeRequest {
  return {
    id: row.id,
    season_id: row.season_id,
    initiated_by: row.initiated_by,
    player_a_id: row.player_a_id,
    from_tracker_a_id: row.from_tracker_a_id,
    line_a: row.line_a,
    player_b_id: row.player_b_id,
    from_tracker_b_id: row.from_tracker_b_id,
    line_b: row.line_b,
    status: row.status as TradeRequest['status'],
    consent_a: row.consent_a,
    consent_b: row.consent_b,
    created_at: row.created_at,
    executed_at: row.executed_at,
    cancelled_at: row.cancelled_at,
    cancelled_by: row.cancelled_by,
    executed_tracker_ids: row.executed_tracker_ids,
  };
}

export interface CreateTradeRequestInput {
  season_id: string;
  initiated_by: string;
  player_a_id: string;
  from_tracker_a_id: string | null;
  line_a: string;
  player_b_id: string;
  from_tracker_b_id: string | null;
  line_b: string;
}

/**
 * Insert a PENDING trade request (both consents default to false).
 *
 * The one-pending-per-tracker rule is enforced by the partial unique indexes
 * `uq_redraft_trade_pending_tracker_a` / `_b`: a duplicate source tracker in a
 * pending row raises a unique_violation (23505). Callers should surface that as
 * a 409 "one of these lines already has a pending trade" rather than a 500.
 */
export async function createTradeRequest(
  input: CreateTradeRequestInput
): Promise<TradeRequest> {
  const insert: TablesInsert<'redraft_trade_requests'> = {
    season_id: input.season_id,
    initiated_by: input.initiated_by,
    player_a_id: input.player_a_id,
    from_tracker_a_id: input.from_tracker_a_id,
    line_a: input.line_a,
    player_b_id: input.player_b_id,
    from_tracker_b_id: input.from_tracker_b_id,
    line_b: input.line_b,
    status: 'pending',
    consent_a: false,
    consent_b: false,
  };

  const { data, error } = await supabase
    .from('redraft_trade_requests')
    .insert(insert)
    .select()
    .single();

  if (error) throw error;
  return toTradeRequest(data);
}

/** Load a single trade request by id (any status). */
export async function getTradeRequest(id: string): Promise<TradeRequest | null> {
  const { data, error } = await supabase
    .from('redraft_trade_requests')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return toTradeRequest(data);
}

/**
 * Pending trade requests that involve a player (as either side). Used by the
 * consent UI to surface what a player still needs to act on.
 */
export async function getPendingTradeRequestsForPlayer(
  seasonId: string,
  playerId: string
): Promise<TradeRequest[]> {
  const { data, error } = await supabase
    .from('redraft_trade_requests')
    .select('*')
    .eq('season_id', seasonId)
    .eq('status', 'pending')
    .or(`player_a_id.eq.${playerId},player_b_id.eq.${playerId}`)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data.map(toTradeRequest);
}

/** All pending trade requests for a season (admin view). */
export async function getPendingTradeRequestsForSeason(
  seasonId: string
): Promise<TradeRequest[]> {
  const { data, error } = await supabase
    .from('redraft_trade_requests')
    .select('*')
    .eq('season_id', seasonId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data.map(toTradeRequest);
}

/**
 * Record one side's consent. Only flips the flag for a still-pending request;
 * returns null if the request is no longer pending (idempotent for late
 * consent). The caller reloads afterwards to check whether both sides are set.
 */
export async function setConsent(
  id: string,
  side: 'a' | 'b'
): Promise<TradeRequest | null> {
  const payload: TablesUpdate<'redraft_trade_requests'> =
    side === 'a' ? { consent_a: true } : { consent_b: true };

  const { data, error } = await supabase
    .from('redraft_trade_requests')
    .update(payload)
    .eq('id', id)
    .eq('status', 'pending')
    .select()
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return toTradeRequest(data);
}

/**
 * Atomically execute a consented trade request via the
 * `epb_execute_trade_request` RPC: in ONE transaction it row-locks the
 * request, claims it (verifying pending AND both consented), re-checks
 * redraft_phase_open, re-checks each swap's remaining points IN SQL, runs the
 * swap (reuse of epb_execute_redraft), and flips status to 'executed' with the
 * new tracker ids. Any failure rolls the whole transaction back — the caller
 * never reverts in TS; it just reloads the request (an RPC failure leaves the
 * request pending and retryable, unless another caller won the race and
 * finalized it).
 *
 * Returns the new tracker ids in swap order. A plpgsql `RAISE EXCEPTION ...
 * ERRCODE='P0001'` from the RPC is mapped to `TradeRequestExecutionError`
 * (carrying the RPC's message + the SQLSTATE) so the route can 409. Any other
 * Postgres error is rethrown verbatim.
 */
export async function executeTradeRequest(
  requestId: string,
  swaps: RedraftSwapPayload[]
): Promise<string[]> {
  const { data, error } = await supabase.rpc('epb_execute_trade_request', {
    p_request_id: requestId,
    // RPC expects jsonb; serialize so only JSON-safe values are sent.
    p_swaps: JSON.parse(JSON.stringify(swaps)) as Json,
  });

  if (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code ?? '')
        : '';
    if (code === 'P0001') {
      throw new TradeRequestExecutionError(error.message, code);
    }
    throw error;
  }
  return (data as string[] | null) ?? [];
}

/**
 * Cancel a pending request. Caller authorization (admin OR either player) is
 * enforced in the route; here we only persist the cancellation. Returns null
 * if the request is no longer pending (caller surfaces a 409).
 */
export async function cancelTradeRequest(
  id: string,
  byPlayerId: string
): Promise<TradeRequest | null> {
  const payload: TablesUpdate<'redraft_trade_requests'> = {
    status: 'cancelled',
    cancelled_at: new Date().toISOString(),
    cancelled_by: byPlayerId,
  };

  const { data, error } = await supabase
    .from('redraft_trade_requests')
    .update(payload)
    .eq('id', id)
    .eq('status', 'pending')
    .select()
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return toTradeRequest(data);
}