import { supabase } from '../client';
import type { Tables } from '@/types/database';

export type EpbGrantType = 'draft_token' | 'kill_token';

type GrantRow = Tables<'epb_token_grants'>;

export interface EpbTokenGrant {
  season_id: string;
  player_id: string;
  grant_type: EpbGrantType;
  /** Total tokens applied in the grant (draft: purchased count; kill: effective progress) */
  token_count: number;
  created_by: string | null;
  created_at: string;
}

function toGrant(row: GrantRow): EpbTokenGrant {
  return {
    season_id: row.season_id,
    player_id: row.player_id,
    grant_type: row.grant_type as EpbGrantType,
    token_count: row.token_count,
    created_by: row.created_by,
    created_at: row.created_at,
  };
}

/** Postgres unique-violation check (duplicate one-shot grant → HTTP 409). */
export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === '23505'
  );
}

/**
 * Get all one-shot token grants for a season (optionally one grant type).
 * A grant row means the player's allocation/distribution already happened —
 * grants survive redrafts, unlike tracker-scoped progress-log lookups.
 */
export async function getTokenGrants(
  seasonId: string,
  grantType?: EpbGrantType
): Promise<EpbTokenGrant[]> {
  let query = supabase
    .from('epb_token_grants')
    .select('*')
    .eq('season_id', seasonId);

  if (grantType) {
    query = query.eq('grant_type', grantType);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data.map(toGrant);
}

export interface TokenGrantAllocation {
  tracker_id: string;
  amount: number;
  note: string | null;
}

/**
 * Atomically record the one-shot grant AND apply all allocations in a single
 * transaction (epb_grant_and_apply_tokens RPC). A duplicate grant raises a
 * unique violation — check with isUniqueViolation() and map to 409.
 */
export async function grantAndApplyTokens(
  seasonId: string,
  playerId: string,
  grantType: EpbGrantType,
  allocations: TokenGrantAllocation[],
  createdBy?: string | null
): Promise<void> {
  const { error } = await supabase.rpc('epb_grant_and_apply_tokens', {
    p_season_id: seasonId,
    p_player_id: playerId,
    p_grant_type: grantType,
    p_allocations: allocations.map((a) => ({
      tracker_id: a.tracker_id,
      amount: a.amount,
      note: a.note,
    })),
    p_created_by: createdBy ?? undefined,                  // omitted = the SQL default NULL
  });

  if (error) throw error;
}
