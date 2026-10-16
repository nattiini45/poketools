import { getLiveAccess } from '@/lib/auth/helpers';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import { getT } from '@/i18n/server';
import { adminCoreMessages } from '@/i18n/messages/admin-core';

/**
 * View gate of the per-match admin pages (`/admin/matches/[id]/**`).
 *
 * `AdminGuard` admits any admin tier: a site admin, or a resource admin of
 * ANY tournament or league. These pages render one match's admin data (the
 * admin notes / dispute log, the override controls), so they also require
 * that the viewer administers THIS match: a site admin, or a resource admin
 * of the match's tournament or of its league (`isResourceAdminFor` cascades
 * from the tournament to its season). That is the same rule the routes the
 * pages call apply (`POST /api/admin/matches/[id]/reset`,
 * `PATCH|DELETE /api/admin/games/[id]`).
 *
 * Decided from the live role read (`getLiveAccess`, D37; memoised per render,
 * so the page and `AdminGuard` share one read), never from the session copy.
 * Signed-out and non-admin viewers get false here and are handled by
 * `AdminGuard` (sign-in redirect, "Access Denied"). A failed read throws
 * (fail closed).
 */
export async function canAdministerMatch(tournamentId: string): Promise<boolean> {
  const access = await getLiveAccess();
  if (!access?.isAnyAdmin || !access.player) return false;
  if (access.isSiteAdmin) return true;
  return isResourceAdminFor(access.player.playerId, 'tournament', tournamentId);
}

/** Shown to an admin who does not administer this match's tournament or league. */
export async function MatchAccessDenied() {
  const t = await getT(adminCoreMessages);
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-2">{t('matches.accessDenied.title')}</h1>
        <p className="text-poke-text-secondary">{t('matches.accessDenied.body')}</p>
      </div>
    </div>
  );
}
