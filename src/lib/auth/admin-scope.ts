import 'server-only';

/**
 * The set of seasons and tournaments an admin may manage, for list and
 * picker routes that must show a resource admin only their own resources.
 *
 * Callers pass the LIVE player returned by `requireAnyAdmin()` (or
 * `requirePlayer()` for a mixed route), never the session copy: the scope is
 * derived from `player.isAdmin` and `player.playerId`, so a stale token would
 * widen it.
 *
 * `null` means unrestricted (site admin). An empty array means "no
 * resources": a resource admin whose assignments were all removed sees none.
 * A scope decides visibility; writes still pass `requireResourceAdmin()`.
 */
import type { SessionPlayer } from '@/types/auth';
import { getAdminSeasonIds, getAdminTournamentIds } from '@/lib/supabase/queries/resource-admins';

export interface AdminScope {
  playerId: string;
  isSiteAdmin: boolean;
  /** Seasons the admin is directly assigned to; null = every season (site admin). */
  seasonIds: string[] | null;
  /**
   * Tournaments the admin may manage; null = every tournament (site admin).
   * Cascades like `isResourceAdminFor('tournament', id)`: directly assigned
   * tournaments plus every tournament (stage) of a season the admin is
   * assigned to. A tournament-only admin does NOT gain the parent season.
   */
  tournamentIds: string[] | null;
}

/** Scope of a live player: unrestricted for a site admin, else the assigned resources. */
export async function getAdminScope(player: SessionPlayer): Promise<AdminScope> {
  if (player.isAdmin) {
    return { playerId: player.playerId, isSiteAdmin: true, seasonIds: null, tournamentIds: null };
  }
  const [seasonIds, tournamentIds] = await Promise.all([
    getAdminSeasonIds(player.playerId),
    getAdminTournamentIds(player.playerId),
  ]);
  return { playerId: player.playerId, isSiteAdmin: false, seasonIds, tournamentIds };
}

/** Whether the scope covers the tournament. An unrestricted scope covers every id. */
export function scopeAllowsTournament(scope: AdminScope, tournamentId: string): boolean {
  return scope.tournamentIds === null || scope.tournamentIds.includes(tournamentId);
}

/** Whether the scope covers the season. An unrestricted scope covers every id. */
export function scopeAllowsSeason(scope: AdminScope, seasonId: string): boolean {
  return scope.seasonIds === null || scope.seasonIds.includes(seasonId);
}
