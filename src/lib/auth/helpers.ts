/**
 * Auth helpers: who is signed in, and may they do this?
 *
 * Two kinds of check (DATA-PLAN fixes 3 and 3b, design decision D37):
 *
 * 1. Session reads use the token and may be up to 5 minutes stale. They are
 *    getSession, getSessionPlayer, isAdmin, isAnyAdmin, isCreator and
 *    isSuperadmin. The session JWT re-reads its player copy at most every
 *    SESSION_PLAYER_TTL_MS (src/auth.ts), or at once on trigger 'update', so a
 *    name, avatar, role or status seen here can lag by up to 5 minutes. Use
 *    them for display and page rendering only. Never authorize a write with them.
 *    getSession() is wrapped in React cache(): one server render (layout,
 *    page, components) runs auth() once. Route handlers have no render
 *    scope, so there each call still runs auth(), which reads no DB within the TTL.
 *
 * 2. Guards are live. They are requireAuth, requirePlayer, requireAdmin,
 *    requireAnyAdmin, requireCreator, requireResourceAdmin and
 *    requireDraftAdmin. Each one takes only the identity (provider + id) from
 *    the token and then re-reads that identity's player with one narrow select
 *    (status, is_admin, is_creator, name fields and an embedded resource_admins
 *    count). It decides from that row and never from the token's copy. So:
 *      - a ban or suspension blocks the player on their next guarded call,
 *        even with a token minted a second earlier;
 *      - revoking admin, creator or resource-admin rights takes effect on the next
 *        guarded call;
 *      - the SessionPlayer a guard returns is the live one;
 *      - the read is memoised per server render (React cache()); in a route
 *        handler it runs once per guard call;
 *      - a failed read throws the database error (fail closed). API routes turn
 *        it into a 500 through safeErrorResponse().
 *    Site admins bypass the ban/suspend check, as before. The superadmin
 *    identity (SUPERADMIN_DISCORD_ID / SUPERADMIN_EMAIL) is always site admin.
 *
 * 3. View gates are live too. getLiveAccess() and getLiveSessionPlayer() make
 *    the same narrow read (memoised per render, so a layout gate, a page gate
 *    and a guard in one render share one query) without throwing AuthError.
 *    Admin and creator pages gate their views with getLiveAccess(), never with
 *    isAdmin, isAnyAdmin or isCreator: an admin page can serialize full player
 *    rows into client components, and a revoked admin must stop seeing them at
 *    once, not up to 5 minutes later.
 */
import { cache } from 'react';
import { auth, loadSessionPlayer } from '@/auth';
import type { Session } from 'next-auth';
import type { SessionPlayer } from '@/types/auth';
import type { AdminResourceType } from '@/types/resource-admin';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import { getDraftPoolById } from '@/lib/supabase/queries/drafts';
import { UserFacingError } from '@/lib/api/user-facing-error';

/**
 * The signed-in session, from the token (see the module comment: may be up to
 * 5 minutes stale). Memoised per server render with React cache().
 */
export const getSession: () => Promise<Session | null> = cache(
  async (): Promise<Session | null> => auth()
);

/** The token's player copy (read paths only; may be up to 5 minutes stale). */
export async function getSessionPlayer(): Promise<SessionPlayer | null> {
  const session = await getSession();
  return session?.player ?? null;
}

/**
 * Live read of the signed-in identity's player. It uses the token only for
 * the identity. Null when the identity has no player. DB errors rethrow.
 */
async function readLivePlayer(session: Session): Promise<SessionPlayer | null> {
  const identityId = session.user?.id;
  if (!identityId) return null;

  const player = await loadSessionPlayer(session.provider ?? 'discord', identityId);
  if (player && isSuperadmin(session)) {
    player.isAdmin = true;
  }
  return player;
}

/**
 * Live player for server components that must gate on current roles or
 * status without throwing (for example an admin-only panel). Null when
 * signed out or when the identity has no player. It does not check ban or
 * suspension; callers decide (getLiveAccess() does). DB errors rethrow.
 */
export async function getLiveSessionPlayer(): Promise<SessionPlayer | null> {
  const session = await getSession();
  if (!session) return null;
  return readLivePlayer(session);
}

/** True when a (live) player may act: not banned or suspended. Site admins always may. */
function isInGoodStanding(player: SessionPlayer): boolean {
  if (player.isAdmin) return true;
  return player.status !== 'banned' && player.status !== 'suspended';
}

/** Live roles of the signed-in identity, for a view gate (see getLiveAccess). */
export interface LiveAccess {
  /** The live player; null when the identity has no player. */
  player: SessionPlayer | null;
  /** Site admin now (live `is_admin`, or the superadmin identity). What requireAdmin() accepts. */
  isSiteAdmin: boolean;
  /** Site admin, or resource admin in good standing. What requireAnyAdmin() accepts. */
  isAnyAdmin: boolean;
  /** Site admin, or content creator in good standing. What requireCreator() accepts. */
  isCreator: boolean;
}

/**
 * Live view gate for server components: AdminGuard, CreatorGuard, the admin
 * layout and any page that renders admin-only data. Null when signed out.
 *
 * Each flag makes the same decision as the matching guard, from the same live
 * row, but returns false instead of throwing: a banned or suspended player
 * gets no role flag unless they are a site admin (site admins bypass, as in
 * the guards). One narrow read, memoised per server render, so the layout,
 * the page and their guards share one query. A failed read rethrows the
 * database error, so the page fails closed (error boundary) rather than
 * rendering admin data.
 */
export async function getLiveAccess(): Promise<LiveAccess | null> {
  const session = await getSession();
  if (!session) return null;

  const player = await readLivePlayer(session);
  if (!player || !isInGoodStanding(player)) {
    return { player, isSiteAdmin: false, isAnyAdmin: false, isCreator: false };
  }
  return {
    player,
    isSiteAdmin: player.isAdmin,
    isAnyAdmin: player.isAdmin || player.isResourceAdmin,
    isCreator: player.isAdmin || player.isCreator,
  };
}

/** Throws 403 unless the (live) player may act. Site admins bypass. */
function assertInGoodStanding(player: SessionPlayer): void {
  if (isInGoodStanding(player)) return;
  if (player.status === 'banned') {
    throw new AuthError('Your account has been banned', 403, 'account_banned');
  }
  if (player.status === 'suspended') {
    throw new AuthError('Your account is currently suspended', 403, 'account_suspended');
  }
}

async function requireSignedIn(): Promise<Session> {
  const session = await getSession();
  if (!session) {
    throw new AuthError('Not authenticated', 401, 'unauthenticated');
  }
  return session;
}

/**
 * Requires a signed-in session. Live check: when the identity has a player,
 * a banned or suspended non-admin is rejected (403). The returned session's
 * `player` is the live player, or null when the identity has no player.
 */
export async function requireAuth(): Promise<Session> {
  const session = await requireSignedIn();
  const player = await readLivePlayer(session);
  if (player) assertInGoodStanding(player);
  return { ...session, player };
}

/**
 * Requires a registered player in good standing. Live check: status and
 * roles come from the database on every call, not from the token.
 */
export async function requirePlayer(): Promise<SessionPlayer> {
  const session = await requireSignedIn();
  const player = await readLivePlayer(session);
  if (!player) {
    throw new AuthError('Not a registered player', 403, 'forbidden');
  }
  // Check suspension/ban status — admins bypass this check
  assertInGoodStanding(player);
  return player;
}

/** Requires site-wide admin (live). Use for player/ruleset management and deletions. */
export async function requireAdmin(): Promise<SessionPlayer> {
  const player = await requirePlayer();
  if (!player.isAdmin) {
    throw new AuthError('Admin access required', 403, 'forbidden');
  }
  return player;
}

/** Requires any admin tier, site or resource (live). Use for creation routes. */
export async function requireAnyAdmin(): Promise<SessionPlayer> {
  const player = await requirePlayer();
  if (!player.isAdmin && !player.isResourceAdmin) {
    throw new AuthError('Admin access required', 403, 'forbidden');
  }
  return player;
}

/**
 * Requires site admin OR resource admin for a specific tournament/season (live).
 * For tournaments, also checks parent season admin (cascading).
 */
export async function requireResourceAdmin(
  resourceType: AdminResourceType,
  resourceId: string
): Promise<SessionPlayer> {
  const player = await requirePlayer();

  // Site admins always pass
  if (player.isAdmin) return player;

  const hasAccess = await isResourceAdminFor(player.playerId, resourceType, resourceId);
  if (!hasAccess) {
    throw new AuthError('Admin access required for this resource', 403, 'forbidden');
  }
  return player;
}

/** A draft pool id is a uuid; anything else names no pool. */
const DRAFT_POOL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Requires site admin OR resource admin for the season that owns a draft pool (live).
 *
 * An unknown pool — including a malformed (non-uuid) id, which never reaches
 * the database — is a `404 POOL_NOT_FOUND` (`errors/draft`). It is a
 * `UserFacingError`, not an `AuthError`: `safeErrorResponse` only forwards
 * `errors/common` codes from an AuthError, and the English text stays
 * 'Draft pool not found'. Site admins pass before the lookup, as before.
 */
export async function requireDraftAdmin(draftPoolId: string): Promise<SessionPlayer> {
  const player = await requirePlayer();

  // Site admins always pass
  if (player.isAdmin) return player;

  const pool = DRAFT_POOL_ID.test(draftPoolId) ? await getDraftPoolById(draftPoolId) : null;
  if (!pool) {
    throw new UserFacingError('Draft pool not found', { status: 404, code: 'POOL_NOT_FOUND' });
  }

  const hasAccess = await isResourceAdminFor(player.playerId, 'season', pool.season_id);
  if (!hasAccess) {
    throw new AuthError('Admin access required for this draft', 403, 'forbidden');
  }
  return player;
}

/** Token-based (read paths only; may be up to 5 minutes stale). */
export function isAdmin(session: Session | null): boolean {
  return session?.player?.isAdmin === true;
}

/**
 * Check if user is the superadmin (SUPERADMIN_DISCORD_ID or SUPERADMIN_EMAIL).
 * Identity-based, so never stale.
 */
export function isSuperadmin(session: Session | null): boolean {
  if (!session) return false;

  // Email/password sessions: match on verified email.
  // (Checked via !== 'credentials' so pre-existing JWTs without a provider
  // field keep working as Discord sessions.)
  if (session.provider === 'credentials') {
    const superadminEmail = process.env.SUPERADMIN_EMAIL;
    return (
      !!superadminEmail &&
      !!session.user?.email &&
      session.user.email.toLowerCase() === superadminEmail.toLowerCase()
    );
  }

  const superadminId = process.env.SUPERADMIN_DISCORD_ID;
  return !!superadminId && session.user?.id === superadminId;
}

/** Check if user is a content creator. Token-based (read paths only; may be up to 5 minutes stale). */
export function isCreator(session: Session | null): boolean {
  return session?.player?.isCreator === true;
}

/** Requires content creator or admin access (live). */
export async function requireCreator(): Promise<SessionPlayer> {
  const player = await requirePlayer();
  if (!player.isCreator && !player.isAdmin) {
    throw new AuthError('Content creator access required', 403, 'forbidden');
  }
  return player;
}

/**
 * Check if user is any kind of admin (site-wide or resource-specific).
 * Token-based (read paths only; may be up to 5 minutes stale).
 */
export function isAnyAdmin(session: Session | null): boolean {
  return session?.player?.isAdmin === true || session?.player?.isResourceAdmin === true;
}

/** Codes an AuthError may carry; keys of `errorsCommon` (i18n-core §4.1). */
export type AuthErrorCode = 'unauthenticated' | 'forbidden' | 'account_banned' | 'account_suspended';

export class AuthError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    /** Machine-readable code, chosen by the throw site; `safeErrorResponse` passes it through. */
    public readonly code?: AuthErrorCode
  ) {
    super(message);
    this.name = 'AuthError';
  }
}
