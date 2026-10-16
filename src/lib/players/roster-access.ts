import 'server-only';
import { AuthError, getSession, isAnyAdmin, requireResourceAdmin } from '@/lib/auth/helpers';
import type { AdminResourceType } from '@/types/resource-admin';

/**
 * Whether the caller of a PUBLIC participant list route may receive the roster
 * admin shape (`AdminSeasonParticipant` / `AdminTournamentParticipant` in
 * `src/lib/players/public-player.ts`) instead of the public one.
 *
 * - Anonymous callers, and signed-in players whose token carries no admin
 *   role at all, get `false` without a database read. The token copy is up to
 *   5 minutes stale, so this pre-check can only withhold the admin shape (a
 *   role granted in the last 5 minutes shows the public list until the token
 *   refreshes); it never grants it.
 * - Everyone else is decided live by `requireResourceAdmin`: site admins and
 *   admins of this season or tournament (a tournament also accepts its
 *   season's admins) get `true`.
 * - An `AuthError` from that guard (not an admin of this resource, banned,
 *   suspended, no player) is an answer, not a failure: the caller simply gets
 *   the public list, which the route serves to everyone.
 * - Any other error (the live read failed) is rethrown, so the route fails
 *   with its `safeErrorResponse` instead of guessing.
 */
export async function canViewAdminRoster(
  resourceType: AdminResourceType,
  resourceId: string,
): Promise<boolean> {
  const session = await getSession();
  if (!isAnyAdmin(session)) return false;

  try {
    await requireResourceAdmin(resourceType, resourceId);
    return true;
  } catch (err) {
    if (err instanceof AuthError) return false;
    throw err;
  }
}
