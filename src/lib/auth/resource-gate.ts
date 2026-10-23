import 'server-only';

/**
 * Live view gate for server pages that are scoped to one season or
 * tournament (admin pages under `/admin/leagues/[id]/...` and
 * `/admin/tournaments/[id]/...`). The route-handler twin is
 * `requireResourceAdmin()` in `helpers.ts`; both decide from the live player.
 *
 * The admin layout's `AdminGuard` only proves "some admin". This adds the
 * per-resource check before any resource data is read.
 */
import { notFound } from 'next/navigation';
import { getLiveAccess } from '@/lib/auth/helpers';
import { isValidUuid } from '@/lib/utils/uuid';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import type { AdminResourceType } from '@/types/resource-admin';

export type ResourceAdminGate =
  | { kind: 'ok'; playerId: string; isSiteAdmin: boolean }
  /** Signed out or not an admin at all: render `AdminGuard`, which redirects / denies. */
  | { kind: 'guard' }
  /** An admin, but not of this resource: render `ResourceForbidden`. */
  | { kind: 'forbidden' };

/**
 * Live check: site admin, or resource admin of this resource in good standing.
 * A tournament also passes for an admin of its parent season (the cascade of
 * `isResourceAdminFor`). A route id that is not a uuid is a 404 before any
 * auth or admin read. A failed read rethrows (the page fails closed).
 */
export async function gateResourceAdmin(type: AdminResourceType, id: string): Promise<ResourceAdminGate> {
  if (!isValidUuid(id)) notFound();
  const access = await getLiveAccess();
  if (!access?.isAnyAdmin || !access.player) return { kind: 'guard' };
  const { playerId } = access.player;
  if (access.isSiteAdmin) return { kind: 'ok', playerId, isSiteAdmin: true };
  const allowed = await isResourceAdminFor(playerId, type, id);
  return allowed ? { kind: 'ok', playerId, isSiteAdmin: false } : { kind: 'forbidden' };
}
