/**
 * AI avatar generation rate limiting.
 * Uses atomic DB-side check + record to prevent concurrent bypass.
 */

import { supabase } from '@/lib/supabase/client';
import { AI_AVATAR_DAILY_LIMIT } from '@/types/avatar';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  used: number;
  limit: number;
}

/**
 * Atomically check whether a player can generate another AI avatar
 * and record the generation if allowed. Uses a Supabase RPC with
 * FOR UPDATE lock to prevent concurrent bypass of the daily limit.
 */
export async function checkAndRecordGeneration(playerId: string): Promise<RateLimitResult> {
  const { data, error } = await supabase.rpc('check_and_record_avatar_generation', {
    p_player_id: playerId,
    p_daily_limit: AI_AVATAR_DAILY_LIMIT,
  });

  if (error) throw error;
  if (!data) throw new Error('No data returned from rate limit RPC');

  const result = data as unknown as RateLimitResult;
  return {
    allowed: result.allowed,
    remaining: result.remaining,
    used: result.used,
    limit: result.limit,
  };
}

/**
 * Check-only variant for UI display (no side effects).
 * Used to show remaining generations without consuming one.
 */
export async function checkGenerationLimit(playerId: string): Promise<RateLimitResult> {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { count, error } = await supabase
    .from('avatar_generations')
    .select('*', { count: 'exact', head: true })
    .eq('player_id', playerId)
    .gte('created_at', twentyFourHoursAgo);

  if (error) throw error;

  const used = count ?? 0;
  const remaining = Math.max(0, AI_AVATAR_DAILY_LIMIT - used);

  return {
    allowed: used < AI_AVATAR_DAILY_LIMIT,
    remaining,
    used,
    limit: AI_AVATAR_DAILY_LIMIT,
  };
}
