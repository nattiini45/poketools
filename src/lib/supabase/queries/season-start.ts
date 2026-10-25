import { supabase } from '../client';
import type { SeasonStartSignals } from '@/lib/season/settings-guards';

/**
 * Status and round count of every phase of a league, in one query: the input
 * of `isSeasonStarted` / `formatChangeLock` (src/lib/season/settings-guards.ts).
 * The rounds come as an embedded count, not one read per phase.
 */
export async function getSeasonPhaseStartSignals(
  seasonId: string
): Promise<SeasonStartSignals['phases']> {
  const { data, error } = await supabase
    .from('tournaments')
    .select('status, rounds ( count )')
    .eq('season_id', seasonId);
  if (error) throw error;
  return (data ?? []).map((row) => {
    const embed = row.rounds as { count: number }[] | null | undefined;
    return { status: row.status, rounds_total: embed?.[0]?.count ?? 0 };
  });
}
