import { supabase } from '@/lib/supabase/client';

export const ADMIN_EXPORT_DAILY_LIMIT = 20;

export interface AdminExportRateLimitResult {
  allowed: boolean;
  remaining: number;
  reset_at: string;
}

function parseRateLimitResult(value: unknown): AdminExportRateLimitResult {
  if (!value || typeof value !== 'object') {
    throw new Error('No data returned from admin export rate limit RPC');
  }

  const result = value as Record<string, unknown>;
  if (
    typeof result.allowed !== 'boolean' ||
    typeof result.remaining !== 'number' ||
    typeof result.reset_at !== 'string'
  ) {
    throw new Error('Invalid admin export rate limit RPC response');
  }

  return {
    allowed: result.allowed,
    remaining: result.remaining,
    reset_at: result.reset_at,
  };
}

export async function checkAndRecordAdminExport(
  playerId: string,
  dailyLimit = ADMIN_EXPORT_DAILY_LIMIT
): Promise<AdminExportRateLimitResult> {
  const { data, error } = await supabase.rpc('check_and_record_admin_export', {
    p_player_id: playerId,
    p_daily_limit: dailyLimit,
  });

  if (error) throw error;
  return parseRateLimitResult(data);
}