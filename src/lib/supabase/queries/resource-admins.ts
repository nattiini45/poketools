import { supabase } from '../client';
import type { AdminResourceType, ResourceAdmin, ResourceAdminWithPlayer } from '@/types/resource-admin';

/**
 * Check if a player is a resource admin for a specific resource.
 * For tournaments, also checks if the player is an admin for the parent season.
 */
export async function isResourceAdminFor(
  playerId: string,
  resourceType: AdminResourceType,
  resourceId: string
): Promise<boolean> {
  if (resourceType === 'tournament') {
    return isSeasonOrTournamentAdmin(playerId, resourceId);
  }

  // Season: direct check only
  const { count, error } = await supabase
    .from('resource_admins')
    .select('*', { count: 'exact', head: true })
    .eq('player_id', playerId)
    .eq('resource_type', resourceType)
    .eq('resource_id', resourceId);

  if (error) throw error;
  return (count ?? 0) > 0;
}

/**
 * Check if a player is admin for a tournament — either directly assigned
 * or via being admin for the tournament's parent season.
 */
export async function isSeasonOrTournamentAdmin(
  playerId: string,
  tournamentId: string
): Promise<boolean> {
  // Check direct tournament assignment
  const { count: directCount, error: directError } = await supabase
    .from('resource_admins')
    .select('*', { count: 'exact', head: true })
    .eq('player_id', playerId)
    .eq('resource_type', 'tournament')
    .eq('resource_id', tournamentId);

  if (directError) throw directError;
  if ((directCount ?? 0) > 0) return true;

  // Look up the tournament's season_id, then check season admin
  const { data: tournament, error: tError } = await supabase
    .from('tournaments')
    .select('season_id')
    .eq('id', tournamentId)
    .maybeSingle();

  if (tError) throw tError;
  if (!tournament?.season_id) return false;

  const { count: seasonCount, error: seasonError } = await supabase
    .from('resource_admins')
    .select('*', { count: 'exact', head: true })
    .eq('player_id', playerId)
    .eq('resource_type', 'season')
    .eq('resource_id', tournament.season_id);

  if (seasonError) throw seasonError;
  return (seasonCount ?? 0) > 0;
}

/**
 * Check if a player has any resource admin assignments at all.
 * Used to populate the session flag for NavBar visibility.
 */
export async function hasAnyResourceAdminRole(playerId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from('resource_admins')
    .select('*', { count: 'exact', head: true })
    .eq('player_id', playerId);

  if (error) throw error;
  return (count ?? 0) > 0;
}

/**
 * List all resource admins for a specific resource.
 */
export async function getResourceAdmins(
  resourceType: AdminResourceType,
  resourceId: string
): Promise<ResourceAdminWithPlayer[]> {
  const { data, error } = await supabase
    .from('resource_admins')
    .select('*, players!resource_admins_player_id_fkey(name)')
    .eq('resource_type', resourceType)
    .eq('resource_id', resourceId);

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    player_id: row.player_id,
    resource_type: row.resource_type as AdminResourceType,
    resource_id: row.resource_id,
    created_at: row.created_at,
    player_name: (row.players as unknown as { name: string })?.name ?? '',
  }));
}

/**
 * Get all resource admin assignments for a player.
 */
export async function getAdminAssignments(playerId: string): Promise<ResourceAdmin[]> {
  const { data, error } = await supabase
    .from('resource_admins')
    .select('*')
    .eq('player_id', playerId);

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    player_id: row.player_id,
    resource_type: row.resource_type as AdminResourceType,
    resource_id: row.resource_id,
    created_at: row.created_at,
  }));
}

/**
 * Get tournament IDs that a resource admin can manage
 * (directly assigned or via season).
 */
export async function getAdminTournamentIds(playerId: string): Promise<string[]> {
  const assignments = await getAdminAssignments(playerId);

  const directTournamentIds = assignments
    .filter((a) => a.resource_type === 'tournament')
    .map((a) => a.resource_id);

  const seasonIds = assignments
    .filter((a) => a.resource_type === 'season')
    .map((a) => a.resource_id);

  if (seasonIds.length > 0) {
    // Get all tournaments in those seasons
    const { data, error } = await supabase
      .from('tournaments')
      .select('id')
      .in('season_id', seasonIds);

    if (error) throw error;
    const seasonTournamentIds = (data ?? []).map((t) => t.id);
    return Array.from(new Set([...directTournamentIds, ...seasonTournamentIds]));
  }

  return directTournamentIds;
}

/**
 * Get season IDs that a resource admin can manage.
 */
export async function getAdminSeasonIds(playerId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('resource_admins')
    .select('resource_id')
    .eq('player_id', playerId)
    .eq('resource_type', 'season');

  if (error) throw error;
  return (data ?? []).map((row) => row.resource_id);
}

/**
 * Assign a player as resource admin.
 */
export async function addResourceAdmin(
  playerId: string,
  resourceType: AdminResourceType,
  resourceId: string
): Promise<ResourceAdmin> {
  const { data, error } = await supabase
    .from('resource_admins')
    .insert({
      player_id: playerId,
      resource_type: resourceType,
      resource_id: resourceId,
    })
    .select()
    .single();

  if (error) throw error;
  return {
    id: data.id,
    player_id: data.player_id,
    resource_type: data.resource_type as AdminResourceType,
    resource_id: data.resource_id,
    created_at: data.created_at,
  };
}

/**
 * Remove a resource admin assignment.
 */
export async function removeResourceAdmin(
  playerId: string,
  resourceType: AdminResourceType,
  resourceId: string
): Promise<void> {
  const { error } = await supabase
    .from('resource_admins')
    .delete()
    .eq('player_id', playerId)
    .eq('resource_type', resourceType)
    .eq('resource_id', resourceId);

  if (error) throw error;
}
