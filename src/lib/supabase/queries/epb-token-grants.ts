import { supabase } from '../client';
import type { Tables } from '@/types/database';

/**
 * The only grant type a stored row can carry. Read-only module: the app writes no grants any more. Draft tokens are
 * bought through epb_draft_token_purchases, so legacy draft_token rows are the only grants left to read. Legacy
 * 'kill_token' grants are refused by the database (no legacy Comeback stock; CHECK epb_token_grants_no_kill_token in
 * 20261018140000_epb_comeback_rules.sql); a row of any other type is a broken invariant and fails the read.
 */
export type EpbGrantType = 'draft_token';

type GrantRow = Tables<'epb_token_grants'>;

export interface EpbTokenGrant {
  season_id: string;
  player_id: string;
  grant_type: EpbGrantType;
  /** Draft Kill Tokens allocated by the grant. */
  token_count: number;
  created_by: string | null;
  created_at: string;
}

function toGrant(row: GrantRow): EpbTokenGrant {
  if (row.grant_type !== 'draft_token') {
    throw new Error(`epb_token_grants: unexpected grant_type '${row.grant_type}' (season ${row.season_id})`);
  }
  return {
    season_id: row.season_id,
    player_id: row.player_id,
    grant_type: row.grant_type,
    token_count: row.token_count,
    created_by: row.created_by,
    created_at: row.created_at,
  };
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
