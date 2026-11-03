import { supabase } from '../client';

/**
 * First-admin setup (`POST /api/bootstrap`). The eligibility check and the promotion run atomically in the
 * `bootstrap_first_admin` function (supabase/migrations/20261018130400_bootstrap_first_admin.sql).
 */

/** True once any player holds the site-admin flag; bootstrap is over for good then. */
export async function siteAdminExists(): Promise<boolean> {
  const { data, error } = await supabase.from('players').select('id').eq('is_admin', true).limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

/**
 * Promote the player to the first site admin. The function answers `promoted`, `admin_exists` (another caller won
 * the race) or `player_not_found`; the caller maps each answer.
 */
export async function promoteFirstAdmin(playerId: string): Promise<string> {
  const { data, error } = await supabase.rpc('bootstrap_first_admin', { p_player_id: playerId });
  if (error) throw error;
  return data;
}
