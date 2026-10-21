import { supabase } from '../client';
import type { Tables, TablesInsert } from '@/types/database';
import type { DraftTierLimit, DraftTierLimitFormData } from '@/types/evolution';

type LimitRow = Tables<'draft_tier_limits'>;

function toLimit(row: LimitRow): DraftTierLimit {
  return {
    id: row.id,
    season_id: row.season_id,
    power_tier: row.power_tier as DraftTierLimit['power_tier'],
    max_picks: row.max_picks,
  };
}

/** Get all tier limits for a season. */
export async function getTierLimits(seasonId: string): Promise<DraftTierLimit[]> {
  const { data, error } = await supabase
    .from('draft_tier_limits')
    .select('*')
    .eq('season_id', seasonId)
    .order('power_tier');

  if (error) throw error;
  return data.map(toLimit);
}

/** Get the limit for a specific tier in a season. Returns null if unlimited. */
export async function getTierLimit(
  seasonId: string,
  powerTier: string
): Promise<DraftTierLimit | null> {
  const { data, error } = await supabase
    .from('draft_tier_limits')
    .select('*')
    .eq('season_id', seasonId)
    .eq('power_tier', powerTier)
    .maybeSingle();

  if (error) throw error;
  return data ? toLimit(data) : null;
}

/**
 * Bulk upsert tier limits for a season.
 * Replaces all existing limits with the new set.
 */
export async function upsertTierLimits(
  seasonId: string,
  limits: DraftTierLimitFormData[]
): Promise<DraftTierLimit[]> {
  // Delete existing limits for this season
  const { error: delError } = await supabase
    .from('draft_tier_limits')
    .delete()
    .eq('season_id', seasonId);

  if (delError) throw delError;

  // Filter out entries with 0 max_picks (unlimited — no row needed)
  const toInsert = limits.filter((l) => l.max_picks > 0);
  if (toInsert.length === 0) return [];

  const inserts: TablesInsert<'draft_tier_limits'>[] = toInsert.map((l) => ({
    season_id: seasonId,
    power_tier: l.power_tier,
    max_picks: l.max_picks,
  }));

  const { data, error } = await supabase
    .from('draft_tier_limits')
    .insert(inserts)
    .select();

  if (error) throw error;
  return data.map(toLimit);
}
