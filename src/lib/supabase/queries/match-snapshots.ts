import { supabase } from '../client';
import type { Json, TablesInsert } from '@/types/database';
import type { MatchEvolutionSnapshot } from '@/types/evolution';

// -- Read --

/**
 * Get all evolution snapshots for a specific match.
 * Used by the match detail page to show historical forms.
 */
export async function getMatchSnapshots(
  matchId: string
): Promise<MatchEvolutionSnapshot[]> {
  const { data, error } = await supabase
    .from('match_evolution_snapshots')
    .select('*')
    .eq('match_id', matchId)
    .order('base_pokemon', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

/**
 * Get snapshots for a specific player across all matches in a season.
 * Useful for player history / progress-over-time views.
 */
export async function getPlayerSnapshots(
  playerId: string,
  limit = 50
): Promise<MatchEvolutionSnapshot[]> {
  const { data, error } = await supabase
    .from('match_evolution_snapshots')
    .select('*')
    .eq('player_id', playerId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

// -- Write --

export type SnapshotInput = TablesInsert<'match_evolution_snapshots'>;

/**
 * Replace evolution snapshots for a match atomically via
 * `epb_replace_match_snapshots` (DELETE + INSERT in one transaction).
 * Empty arrays clear existing rows so re-finalization stays idempotent.
 */
export async function insertMatchSnapshots(
  matchId: string,
  snapshots: SnapshotInput[]
): Promise<void> {
  const payload = snapshots.map((s) => ({
    player_id: s.player_id,
    tracker_id: s.tracker_id ?? null,
    base_pokemon: s.base_pokemon,
    line_id: s.line_id ?? null,
    species_at_match: s.species_at_match,
    stage_at_match: s.stage_at_match,
    progress_before: s.progress_before ?? 0,
    progress_after: s.progress_after ?? 0,
    real_kos: s.real_kos ?? 0,
    draft_tokens_delta: s.draft_tokens_delta ?? 0,
    kill_tokens_delta: s.kill_tokens_delta ?? 0,
    cosmo_points_delta: s.cosmo_points_delta ?? 0,
    evolution_triggered: s.evolution_triggered ?? false,
    suspension_triggered: s.suspension_triggered ?? false,
    brought: s.brought ?? false,
  }));

  const { error } = await supabase.rpc('epb_replace_match_snapshots', {
    p_match_id: matchId,
    p_snapshots: JSON.parse(JSON.stringify(payload)) as Json,
  });

  if (error) throw error;
}

/**
 * Delete all snapshots for a match (used when a match result is undone).
 */
export async function deleteMatchSnapshots(matchId: string): Promise<void> {
  const { error } = await supabase
    .from('match_evolution_snapshots')
    .delete()
    .eq('match_id', matchId);

  if (error) throw error;
}
