/**
 * AI endpoint rate limiting.
 * Uses atomic DB-side check + record to prevent concurrent bypass.
 * Mirrors the avatar rate-limit pattern in lib/avatar/rate-limit.ts.
 */

import { supabase } from '@/lib/supabase/client';

const AI_DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT) || 10;
/** Agent chat gets its own, more generous, daily budget (PRD §9). */
const AGENT_DAILY_LIMIT = Number(process.env.AGENT_DAILY_LIMIT) || 20;

export type AiEndpoint =
  | 'match-analysis'
  | 'match-prep-analysis'
  | 'tournament-report'
  | 'slot-coach'
  | 'team-coach'
  | 'agent-chat';

/** Per-endpoint daily limit; endpoints not listed fall back to {@link AI_DAILY_LIMIT}. */
const ENDPOINT_DAILY_LIMIT: Partial<Record<AiEndpoint, number>> = {
  'agent-chat': AGENT_DAILY_LIMIT,
};

export interface AiRateLimitResult {
  allowed: boolean;
  remaining: number;
  used: number;
  limit: number;
}

/**
 * Atomically check whether a player can use an AI endpoint
 * and record the usage if allowed.
 */
export async function checkAndRecordAiGeneration(
  playerId: string,
  endpoint: AiEndpoint
): Promise<AiRateLimitResult> {
  const { data, error } = await supabase.rpc('check_and_record_ai_generation', {
    p_player_id: playerId,
    p_endpoint: endpoint,
    p_daily_limit: ENDPOINT_DAILY_LIMIT[endpoint] ?? AI_DAILY_LIMIT,
  });

  if (error) throw error;
  if (!data) throw new Error('No data returned from AI rate limit RPC');

  return data as unknown as AiRateLimitResult;
}
