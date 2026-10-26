import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Session } from 'next-auth';
import type { SessionPlayer } from '@/types/auth';

// ── React: use the react-server build so cache() really memoises ─────
//
// Vitest resolves 'react' to the client build, whose cache() is a
// pass-through. Next.js renders server components with the react-server
// build, whose cache() memoises per request through the async dispatcher
// (ReactSharedInternals.A). The tests load that build and drive it with a
// stand-in dispatcher that provides the same getCacheForType contract as the
// Flight request: one cache per render.
vi.mock('react', async () => {
  const { createRequire } = await import('node:module');
  const path = await import('node:path');
  const nodeRequire = createRequire(import.meta.url);
  const reactDir = path.dirname(nodeRequire.resolve('react/package.json'));
  return nodeRequire(path.join(reactDir, 'cjs', 'react.react-server.development.js'));
});

// ── Mock the auth() function and the live player read ─────────────────

vi.mock('@/auth', () => ({
  auth: vi.fn(),
  loadSessionPlayer: vi.fn(),
}));

// Mock resource admin check (used by requireResourceAdmin)
vi.mock('@/lib/supabase/queries/resource-admins', () => ({
  isResourceAdminFor: vi.fn(),
}));

// Mock getDraftPoolById (used by requireDraftAdmin)
vi.mock('@/lib/supabase/queries/drafts', () => ({
  getDraftPoolById: vi.fn(),
}));

import * as React from 'react';
import { auth, loadSessionPlayer } from '@/auth';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import { getDraftPoolById } from '@/lib/supabase/queries/drafts';
import {
  getSession,
  getSessionPlayer,
  getLiveSessionPlayer,
  getLiveAccess,
  requireAuth,
  requirePlayer,
  requireAdmin,
  requireSuperadmin,
  requireCreator,
  requireAnyAdmin,
  requireResourceAdmin,
  requireDraftAdmin,
  isAdmin,
  isCreator,
  isSuperadmin,
  isReservedSuperadminEmail,
  isAnyAdmin,
  AuthError,
} from '../helpers';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { safeErrorResponse } from '@/lib/api/error-response';

// Cast to the session-returning overload only; NextAuth v5's `auth` is also
// typed as NextMiddleware, which confuses vi.mocked's type inference.
const mockedAuth = vi.mocked(auth) as unknown as ReturnType<typeof vi.fn<() => Promise<Session | null>>>;
const mockedLoad = vi.mocked(loadSessionPlayer);

// ── Render scope (stand-in for the Flight request dispatcher) ────────

interface CacheDispatcher {
  getCacheForType: <T>(createCache: () => T) => T;
}

const serverInternals = (
  React as unknown as {
    __SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: { A: CacheDispatcher | null };
  }
).__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

/** Run `fn` as one server render: every cache() call inside shares one cache. */
async function inRender<T>(fn: () => Promise<T>): Promise<T> {
  const caches = new Map<unknown, unknown>();
  const previous = serverInternals.A;
  serverInternals.A = {
    getCacheForType<C>(createCache: () => C): C {
      if (!caches.has(createCache)) caches.set(createCache, createCache());
      return caches.get(createCache) as C;
    },
  };
  try {
    return await fn();
  } finally {
    serverInternals.A = previous;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function makePlayer(overrides?: Partial<SessionPlayer>): SessionPlayer {
  return {
    playerId: 'player-1',
    name: 'Test Player',
    isAdmin: false,
    isResourceAdmin: false,
    isCreator: false,
    psUsername: '',
    championsUsername: '',
    avatarUrl: null,
    status: 'active' as const,
    ...overrides,
  };
}

function makeSession(player?: SessionPlayer | null): Session {
  return {
    user: { id: 'discord-1', name: 'Test', email: 'test@example.com', image: null },
    player: player ?? null,
    expires: '2025-01-01',
  };
}

/** Token says one thing, the database (live read) says another. */
function signIn(tokenPlayer: SessionPlayer | null, livePlayer: SessionPlayer | null = tokenPlayer): void {
  mockedAuth.mockResolvedValue(makeSession(tokenPlayer));
  // A fresh object per call, as loadSessionPlayer returns.
  mockedLoad.mockImplementation(async () => (livePlayer ? { ...livePlayer } : null));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedLoad.mockReset();
  delete process.env.SUPERADMIN_DISCORD_ID;
  delete process.env.SUPERADMIN_EMAIL;
});

afterEach(() => {
  serverInternals.A = null;
});

// ── AuthError ────────────────────────────────────────────────────────

describe('AuthError', () => {
  it('sets statusCode and name', () => {
    const err = new AuthError('Forbidden', 403);
    expect(err.message).toBe('Forbidden');
    expect(err.statusCode).toBe(403);
    expect(err.name).toBe('AuthError');
  });

  it('is an instance of Error', () => {
    const err = new AuthError('test', 500);
    expect(err).toBeInstanceOf(Error);
  });
});

// ── Pure sync functions (token-based) ────────────────────────────────

describe('isAdmin', () => {
  it('returns true for admin session', () => {
    const session = makeSession(makePlayer({ isAdmin: true }));
    expect(isAdmin(session)).toBe(true);
  });

  it('returns false for non-admin session', () => {
    const session = makeSession(makePlayer({ isAdmin: false }));
    expect(isAdmin(session)).toBe(false);
  });

  it('returns false for null session', () => {
    expect(isAdmin(null)).toBe(false);
  });

  it('returns false when player is null', () => {
    const session = makeSession(null);
    expect(isAdmin(session)).toBe(false);
  });
});

describe('isCreator', () => {
  it('returns true for creator session', () => {
    const session = makeSession(makePlayer({ isCreator: true }));
    expect(isCreator(session)).toBe(true);
  });

  it('returns false for non-creator session', () => {
    const session = makeSession(makePlayer({ isCreator: false }));
    expect(isCreator(session)).toBe(false);
  });

  it('returns false for null session', () => {
    expect(isCreator(null)).toBe(false);
  });
});

describe('isSuperadmin', () => {
  it('returns true when user id matches SUPERADMIN_DISCORD_ID', () => {
    process.env.SUPERADMIN_DISCORD_ID = 'discord-1';
    const session = makeSession(makePlayer());
    expect(isSuperadmin(session)).toBe(true);
  });

  it('returns false when user id does not match', () => {
    process.env.SUPERADMIN_DISCORD_ID = 'other-id';
    const session = makeSession(makePlayer());
    expect(isSuperadmin(session)).toBe(false);
  });

  it('returns false when env var is not set', () => {
    const session = makeSession(makePlayer());
    expect(isSuperadmin(session)).toBe(false);
  });

  it('returns false for null session', () => {
    process.env.SUPERADMIN_DISCORD_ID = 'discord-1';
    expect(isSuperadmin(null)).toBe(false);
  });

  it('ignores SUPERADMIN_DISCORD_ID for credentials sessions', () => {
    process.env.SUPERADMIN_DISCORD_ID = 'discord-1';
    // user.id happens to equal the superadmin Discord ID, but the session is
    // an email/password session — must not be promoted.
    const session: Session = { ...makeSession(makePlayer()), provider: 'credentials' };
    expect(isSuperadmin(session)).toBe(false);
  });

  it('matches SUPERADMIN_EMAIL for credentials sessions (case-insensitive)', () => {
    process.env.SUPERADMIN_EMAIL = 'Test@Example.com';
    const session: Session = { ...makeSession(makePlayer()), provider: 'credentials' };
    expect(isSuperadmin(session)).toBe(true);
  });

  it('ignores SUPERADMIN_EMAIL for discord sessions', () => {
    process.env.SUPERADMIN_EMAIL = 'test@example.com';
    const session: Session = { ...makeSession(makePlayer()), provider: 'discord' };
    expect(isSuperadmin(session)).toBe(false);
  });

  it('returns false for credentials session when SUPERADMIN_EMAIL is unset', () => {
    const session: Session = { ...makeSession(makePlayer()), provider: 'credentials' };
    expect(isSuperadmin(session)).toBe(false);
  });
});

describe('isReservedSuperadminEmail', () => {
  it('matches SUPERADMIN_EMAIL case-insensitively and ignoring surrounding whitespace', () => {
    process.env.SUPERADMIN_EMAIL = '  Boss@Example.com ';
    expect(isReservedSuperadminEmail('boss@example.com')).toBe(true);
    expect(isReservedSuperadminEmail('  BOSS@EXAMPLE.COM	')).toBe(true);
  });

  it('does not match a different address', () => {
    process.env.SUPERADMIN_EMAIL = 'boss@example.com';
    expect(isReservedSuperadminEmail('boss2@example.com')).toBe(false);
    expect(isReservedSuperadminEmail('')).toBe(false);
    expect(isReservedSuperadminEmail(null)).toBe(false);
    expect(isReservedSuperadminEmail(undefined)).toBe(false);
  });

  it('returns false when SUPERADMIN_EMAIL is unset or blank', () => {
    expect(isReservedSuperadminEmail('boss@example.com')).toBe(false);
    expect(isReservedSuperadminEmail('')).toBe(false);
    process.env.SUPERADMIN_EMAIL = '   ';
    expect(isReservedSuperadminEmail('')).toBe(false);
    expect(isReservedSuperadminEmail('   ')).toBe(false);
  });

  it('isSuperadmin uses the same normalization for credentials sessions', () => {
    process.env.SUPERADMIN_EMAIL = ' Boss@Example.com ';
    const base = makeSession(makePlayer());
    const session: Session = {
      ...base,
      provider: 'credentials',
      user: { ...base.user, email: 'boss@example.com ' },
    };
    expect(isSuperadmin(session)).toBe(true);
  });
});

describe('isAnyAdmin', () => {
  it('returns true for site admin', () => {
    const session = makeSession(makePlayer({ isAdmin: true }));
    expect(isAnyAdmin(session)).toBe(true);
  });

  it('returns true for resource admin', () => {
    const session = makeSession(makePlayer({ isResourceAdmin: true }));
    expect(isAnyAdmin(session)).toBe(true);
  });

  it('returns false for regular player', () => {
    const session = makeSession(makePlayer());
    expect(isAnyAdmin(session)).toBe(false);
  });
});

// ── getSession: React cache() per render ─────────────────────────────

describe('getSession cache()', () => {
  it('three getSession calls in one render run auth() once', async () => {
    const session = makeSession(makePlayer());
    mockedAuth.mockResolvedValue(session);

    const results = await inRender(async () => [
      await getSession(),
      await getSession(),
      await getSession(),
    ]);

    expect(mockedAuth).toHaveBeenCalledTimes(1);
    expect(results).toEqual([session, session, session]);
  });

  it('three concurrent getSession calls in one render run auth() once', async () => {
    mockedAuth.mockResolvedValue(makeSession(makePlayer()));
    await inRender(() => Promise.all([getSession(), getSession(), getSession()]));
    expect(mockedAuth).toHaveBeenCalledTimes(1);
  });

  it('layout, page and a guard in one render share one auth() call', async () => {
    signIn(makePlayer({ isCreator: true }));
    await inRender(async () => {
      await getSession(); // layout
      await getSessionPlayer(); // page
      await requireCreator(); // guard
    });
    expect(mockedAuth).toHaveBeenCalledTimes(1);
  });

  it('each render runs auth() once of its own (no cross-request reuse)', async () => {
    mockedAuth.mockResolvedValue(makeSession(makePlayer()));
    await inRender(async () => { await getSession(); await getSession(); });
    await inRender(async () => { await getSession(); await getSession(); });
    expect(mockedAuth).toHaveBeenCalledTimes(2);
  });

  it('outside a render (route handler) every call runs auth()', async () => {
    mockedAuth.mockResolvedValue(makeSession(makePlayer()));
    await getSession();
    await getSession();
    expect(mockedAuth).toHaveBeenCalledTimes(2);
  });
});

describe('getSession', () => {
  it('returns session when authenticated', async () => {
    const session = makeSession(makePlayer());
    mockedAuth.mockResolvedValue(session);
    const result = await getSession();
    expect(result).toBe(session);
  });

  it('returns null when not authenticated', async () => {
    mockedAuth.mockResolvedValue(null);
    const result = await getSession();
    expect(result).toBeNull();
  });
});

describe('getSessionPlayer (token-based read path)', () => {
  it('returns the token player without a live read', async () => {
    const player = makePlayer();
    mockedAuth.mockResolvedValue(makeSession(player));
    const result = await getSessionPlayer();
    expect(result).toBe(player);
    expect(mockedLoad).not.toHaveBeenCalled();
  });

  it('returns null when session has no player', async () => {
    mockedAuth.mockResolvedValue(makeSession(null));
    const result = await getSessionPlayer();
    expect(result).toBeNull();
  });

  it('returns null when not authenticated', async () => {
    mockedAuth.mockResolvedValue(null);
    const result = await getSessionPlayer();
    expect(result).toBeNull();
  });
});

describe('getLiveSessionPlayer', () => {
  it('returns null when signed out, without a live read', async () => {
    mockedAuth.mockResolvedValue(null);
    expect(await getLiveSessionPlayer()).toBeNull();
    expect(mockedLoad).not.toHaveBeenCalled();
  });

  it('returns the live player, not the token copy', async () => {
    signIn(makePlayer({ isAdmin: true }), makePlayer({ isAdmin: false, name: 'Renamed' }));
    const result = await getLiveSessionPlayer();
    expect(result).toMatchObject({ isAdmin: false, name: 'Renamed' });
  });
});

// ── getLiveAccess: live view gate (AdminGuard, CreatorGuard, admin layout) ──

describe('getLiveAccess', () => {
  it('returns null when signed out, without a live read', async () => {
    mockedAuth.mockResolvedValue(null);
    expect(await getLiveAccess()).toBeNull();
    expect(mockedLoad).not.toHaveBeenCalled();
  });

  it('denies a revoked admin at once, although the token still says admin', async () => {
    signIn(makePlayer({ isAdmin: true }), makePlayer({ isAdmin: false }));
    // The token-based check still says yes: that is the staleness being closed.
    expect(isAnyAdmin(await getSession())).toBe(true);

    const access = await getLiveAccess();
    expect(access).toMatchObject({ isSiteAdmin: false, isAnyAdmin: false, isCreator: false });
    expect(mockedLoad).toHaveBeenCalledWith('discord', 'discord-1');
  });

  it('denies a player whose last resource-admin assignment was removed', async () => {
    signIn(makePlayer({ isResourceAdmin: true }), makePlayer({ isResourceAdmin: false }));
    expect((await getLiveAccess())?.isAnyAdmin).toBe(false);
  });

  it('denies a revoked creator at once', async () => {
    signIn(makePlayer({ isCreator: true }), makePlayer({ isCreator: false }));
    expect((await getLiveAccess())?.isCreator).toBe(false);
  });

  it('grants a newly granted role before the token catches up', async () => {
    signIn(makePlayer(), makePlayer({ isResourceAdmin: true, isCreator: true }));
    expect(await getLiveAccess()).toMatchObject({
      isSiteAdmin: false,
      isAnyAdmin: true,
      isCreator: true,
    });
  });

  it('gives a banned or suspended resource admin or creator no role, as the guards do', async () => {
    for (const status of ['banned', 'suspended'] as const) {
      signIn(
        makePlayer({ isResourceAdmin: true, isCreator: true }),
        makePlayer({ isResourceAdmin: true, isCreator: true, status })
      );
      const access = await getLiveAccess();
      expect(access).toMatchObject({ isSiteAdmin: false, isAnyAdmin: false, isCreator: false });
      expect(access?.player?.status).toBe(status);
      await expect(requireAnyAdmin()).rejects.toMatchObject({ statusCode: 403 });
      await expect(requireCreator()).rejects.toMatchObject({ statusCode: 403 });
    }
  });

  it('lets a live site admin through regardless of status (admin bypass, as in the guards)', async () => {
    signIn(makePlayer({ isAdmin: true }), makePlayer({ isAdmin: true, status: 'suspended' }));
    expect(await getLiveAccess()).toMatchObject({
      isSiteAdmin: true,
      isAnyAdmin: true,
      isCreator: true,
    });
  });

  it('treats the superadmin identity as site admin even when the row is not', async () => {
    process.env.SUPERADMIN_DISCORD_ID = 'discord-1';
    signIn(makePlayer(), makePlayer({ isAdmin: false }));
    expect((await getLiveAccess())?.isSiteAdmin).toBe(true);
  });

  it('flags isSuperadmin only for the superadmin identity, not for any site admin', async () => {
    signIn(makePlayer({ isAdmin: true }));
    expect((await getLiveAccess())?.isSuperadmin).toBe(false);

    process.env.SUPERADMIN_DISCORD_ID = 'discord-1';
    expect((await getLiveAccess())?.isSuperadmin).toBe(true);
  });

  it('gives the superadmin identity of a player row that is not found no superadmin flag', async () => {
    process.env.SUPERADMIN_DISCORD_ID = 'discord-1';
    signIn(makePlayer(), null);
    expect((await getLiveAccess())?.isSuperadmin).toBe(false);
  });

  it('returns no roles when the identity has no player', async () => {
    signIn(makePlayer({ isAdmin: true }), null);
    expect(await getLiveAccess()).toEqual({
      player: null,
      isSiteAdmin: false,
      isAnyAdmin: false,
      isCreator: false,
      isSuperadmin: false,
    });
  });

  it('fails closed: a failed live read rethrows the database error', async () => {
    mockedAuth.mockResolvedValue(makeSession(makePlayer({ isAdmin: true })));
    mockedLoad.mockRejectedValue(new Error('db down'));
    await expect(getLiveAccess()).rejects.toThrow('db down');
  });

  it('layout gate, page gate and a guard in one render share one auth() call', async () => {
    signIn(makePlayer({ isAdmin: true }));
    await inRender(async () => {
      await getLiveAccess(); // admin layout (sidebar roles)
      await getLiveAccess(); // AdminGuard
      await requireAdmin(); // a server action or guard in the same render
    });
    expect(mockedAuth).toHaveBeenCalledTimes(1);
    // The live read itself is memoised per render inside loadSessionPlayer
    // (src/auth.ts); see live-access-render.test.ts for the one-query proof.
    expect(new Set(mockedLoad.mock.calls.map((args) => args.join(':')))).toEqual(
      new Set(['discord:discord-1'])
    );
  });
});

// ── Guards: live status and role checks ─────────────────────────────

describe('requireAuth', () => {
  it('returns the session with the live player', async () => {
    signIn(makePlayer({ name: 'Old' }), makePlayer({ name: 'New' }));
    const result = await requireAuth();
    expect(result.user.id).toBe('discord-1');
    expect(result.player).toMatchObject({ name: 'New' });
    expect(mockedLoad).toHaveBeenCalledWith('discord', 'discord-1');
  });

  it('throws AuthError(401) when not authenticated, without a live read', async () => {
    mockedAuth.mockResolvedValue(null);
    await expect(requireAuth()).rejects.toThrow(AuthError);
    await expect(requireAuth()).rejects.toMatchObject({ statusCode: 401 });
    expect(mockedLoad).not.toHaveBeenCalled();
  });

  it('rejects a banned player even though the token says active', async () => {
    signIn(makePlayer({ status: 'active' }), makePlayer({ status: 'banned' }));
    await expect(requireAuth()).rejects.toMatchObject({
      statusCode: 403,
      message: 'Your account has been banned',
    });
  });

  it('returns player null when the identity has no player', async () => {
    signIn(makePlayer(), null);
    const result = await requireAuth();
    expect(result.player).toBeNull();
  });
});

describe('requirePlayer', () => {
  it('returns the live player when registered and active', async () => {
    signIn(makePlayer({ name: 'Token Name' }), makePlayer({ name: 'Live Name' }));
    const result = await requirePlayer();
    expect(result).toMatchObject({ playerId: 'player-1', name: 'Live Name', status: 'active' });
  });

  it('rejects a banned player on the next call even with a fresh token', async () => {
    // A token minted a moment ago still says active; the ban is in the DB.
    signIn(makePlayer({ status: 'active' }));
    await expect(requirePlayer()).resolves.toMatchObject({ status: 'active' });

    signIn(makePlayer({ status: 'active' }), makePlayer({ status: 'banned' }));
    await expect(requirePlayer()).rejects.toMatchObject({
      name: 'AuthError',
      statusCode: 403,
      message: 'Your account has been banned',
    });
  });

  it('rejects a suspended player on the next call even with a fresh token', async () => {
    signIn(makePlayer({ status: 'active' }), makePlayer({ status: 'suspended' }));
    await expect(requirePlayer()).rejects.toMatchObject({
      statusCode: 403,
      message: 'Your account is currently suspended',
    });
  });

  it('lets a reinstated player through even while the token still says banned', async () => {
    signIn(makePlayer({ status: 'banned' }), makePlayer({ status: 'active' }));
    await expect(requirePlayer()).resolves.toMatchObject({ status: 'active' });
  });

  it('lets a live site admin through regardless of status (admin bypass)', async () => {
    signIn(makePlayer(), makePlayer({ isAdmin: true, status: 'banned' }));
    await expect(requirePlayer()).resolves.toMatchObject({ isAdmin: true });
  });

  it('applies the ban to an admin whose admin role was revoked', async () => {
    signIn(makePlayer({ isAdmin: true }), makePlayer({ isAdmin: false, status: 'banned' }));
    await expect(requirePlayer()).rejects.toMatchObject({ statusCode: 403 });
  });

  it('reads live on every call outside a render', async () => {
    signIn(makePlayer());
    await requirePlayer();
    await requirePlayer();
    expect(mockedLoad).toHaveBeenCalledTimes(2);
  });

  it('reads by the token identity: credentials provider and auth user id', async () => {
    mockedAuth.mockResolvedValue({ ...makeSession(makePlayer()), provider: 'credentials', user: { id: 'auth-uuid-1' } });
    mockedLoad.mockResolvedValue(makePlayer());
    await requirePlayer();
    expect(mockedLoad).toHaveBeenCalledWith('credentials', 'auth-uuid-1');
  });

  it('treats a legacy session without a provider as discord', async () => {
    signIn(makePlayer());
    await requirePlayer();
    expect(mockedLoad).toHaveBeenCalledWith('discord', 'discord-1');
  });

  it('throws AuthError(403) when the identity has no player, even if the token has one', async () => {
    signIn(makePlayer(), null);
    await expect(requirePlayer()).rejects.toThrow(AuthError);
    await expect(requirePlayer()).rejects.toMatchObject({ statusCode: 403, message: 'Not a registered player' });
  });

  it('throws AuthError(403) when session has no player and the DB has none', async () => {
    signIn(null, null);
    await expect(requirePlayer()).rejects.toMatchObject({ statusCode: 403 });
  });

  it('throws AuthError(401) when not authenticated', async () => {
    mockedAuth.mockResolvedValue(null);
    await expect(requirePlayer()).rejects.toMatchObject({ statusCode: 401 });
    expect(mockedLoad).not.toHaveBeenCalled();
  });

  it('fails closed with the database error when the live read fails', async () => {
    mockedAuth.mockResolvedValue(makeSession(makePlayer()));
    const dbError = Object.assign(new Error('connection refused'), { code: 'PGRST000' });
    mockedLoad.mockRejectedValue(dbError);
    await expect(requirePlayer()).rejects.toBe(dbError);
  });
});

describe('requireAdmin', () => {
  it('returns player when admin', async () => {
    signIn(makePlayer({ isAdmin: true }));
    const result = await requireAdmin();
    expect(result.isAdmin).toBe(true);
  });

  it('throws AuthError(403) when not admin', async () => {
    signIn(makePlayer({ isAdmin: false }));
    await expect(requireAdmin()).rejects.toThrow(AuthError);
    await expect(requireAdmin()).rejects.toMatchObject({ statusCode: 403 });
  });

  it('rejects a revoked admin immediately, although the token still says admin', async () => {
    signIn(makePlayer({ isAdmin: true }), makePlayer({ isAdmin: false }));
    await expect(requireAdmin()).rejects.toMatchObject({
      statusCode: 403,
      message: 'Admin access required',
    });
  });

  it('accepts a newly granted admin before the token catches up', async () => {
    signIn(makePlayer({ isAdmin: false }), makePlayer({ isAdmin: true }));
    await expect(requireAdmin()).resolves.toMatchObject({ isAdmin: true });
  });

  it('treats the superadmin identity as admin even when the row is not', async () => {
    process.env.SUPERADMIN_DISCORD_ID = 'discord-1';
    signIn(makePlayer(), makePlayer({ isAdmin: false }));
    await expect(requireAdmin()).resolves.toMatchObject({ isAdmin: true });
  });
});

describe('requireSuperadmin', () => {
  it('passes for the Discord superadmin identity, with the live player marked admin', async () => {
    process.env.SUPERADMIN_DISCORD_ID = 'discord-1';
    signIn(makePlayer(), makePlayer({ isAdmin: false }));
    await expect(requireSuperadmin()).resolves.toMatchObject({ playerId: 'player-1', isAdmin: true });
  });

  it('passes for the credentials superadmin identity (SUPERADMIN_EMAIL)', async () => {
    process.env.SUPERADMIN_EMAIL = 'test@example.com';
    mockedAuth.mockResolvedValue({ ...makeSession(makePlayer()), provider: 'credentials' });
    mockedLoad.mockImplementation(async () => makePlayer());
    await expect(requireSuperadmin()).resolves.toMatchObject({ isAdmin: true });
    expect(mockedLoad).toHaveBeenCalledWith('credentials', 'discord-1');
  });

  it('throws AuthError(401) when not authenticated, without a live read', async () => {
    mockedAuth.mockResolvedValue(null);
    await expect(requireSuperadmin()).rejects.toMatchObject({ statusCode: 401, code: 'unauthenticated' });
    expect(mockedLoad).not.toHaveBeenCalled();
  });

  it('refuses a site admin that is not the superadmin identity', async () => {
    process.env.SUPERADMIN_DISCORD_ID = 'someone-else';
    signIn(makePlayer({ isAdmin: true }));
    await expect(requireSuperadmin()).rejects.toThrow(AuthError);
    await expect(requireSuperadmin()).rejects.toMatchObject({
      statusCode: 403,
      code: 'forbidden',
      message: 'Superadmin access required',
    });
  });

  it('refuses a site admin when no superadmin identity is configured', async () => {
    signIn(makePlayer({ isAdmin: true }));
    await expect(requireSuperadmin()).rejects.toMatchObject({ statusCode: 403 });
  });

  it('refuses a credentials session on the Discord superadmin id (and the reverse)', async () => {
    process.env.SUPERADMIN_DISCORD_ID = 'discord-1';
    mockedAuth.mockResolvedValue({ ...makeSession(makePlayer()), provider: 'credentials' });
    mockedLoad.mockImplementation(async () => makePlayer({ isAdmin: true }));
    await expect(requireSuperadmin()).rejects.toMatchObject({ statusCode: 403 });
  });

  it('refuses the superadmin identity without a player row (403, like every admin action)', async () => {
    process.env.SUPERADMIN_DISCORD_ID = 'discord-1';
    signIn(makePlayer({ isAdmin: true }), null);
    await expect(requireSuperadmin()).rejects.toMatchObject({ statusCode: 403, code: 'forbidden' });
  });

  it('lets the superadmin identity through whatever the row status says (site admins bypass standing)', async () => {
    process.env.SUPERADMIN_DISCORD_ID = 'discord-1';
    signIn(makePlayer(), makePlayer({ status: 'banned' }));
    await expect(requireSuperadmin()).resolves.toMatchObject({ isAdmin: true });
  });

  it('reads the identity from the token and the player live: a revoked token admin without the identity is refused', async () => {
    signIn(makePlayer({ isAdmin: true }), makePlayer({ isAdmin: false }));
    await expect(requireSuperadmin()).rejects.toMatchObject({ statusCode: 403 });
  });

  it('runs auth() once per call', async () => {
    process.env.SUPERADMIN_DISCORD_ID = 'discord-1';
    signIn(makePlayer());
    await requireSuperadmin();
    expect(mockedAuth).toHaveBeenCalledTimes(1);
  });
});

describe('requireCreator', () => {
  it('passes for content creator', async () => {
    signIn(makePlayer({ isCreator: true }));
    const result = await requireCreator();
    expect(result.isCreator).toBe(true);
  });

  it('passes for admin (admin overrides creator check)', async () => {
    signIn(makePlayer({ isAdmin: true, isCreator: false }));
    const result = await requireCreator();
    expect(result.isAdmin).toBe(true);
  });

  it('throws AuthError(403) for regular player', async () => {
    signIn(makePlayer());
    await expect(requireCreator()).rejects.toThrow(AuthError);
    await expect(requireCreator()).rejects.toMatchObject({ statusCode: 403 });
  });

  it('rejects a revoked creator immediately', async () => {
    signIn(makePlayer({ isCreator: true }), makePlayer({ isCreator: false }));
    await expect(requireCreator()).rejects.toMatchObject({ statusCode: 403 });
  });

  it('rejects a banned creator', async () => {
    signIn(makePlayer({ isCreator: true }), makePlayer({ isCreator: true, status: 'banned' }));
    await expect(requireCreator()).rejects.toMatchObject({ statusCode: 403, message: 'Your account has been banned' });
  });
});

describe('requireAnyAdmin', () => {
  it('passes for site admin', async () => {
    signIn(makePlayer({ isAdmin: true }));
    const result = await requireAnyAdmin();
    expect(result.isAdmin).toBe(true);
  });

  it('passes for resource admin', async () => {
    signIn(makePlayer({ isResourceAdmin: true }));
    const result = await requireAnyAdmin();
    expect(result.isResourceAdmin).toBe(true);
  });

  it('throws AuthError(403) for regular player', async () => {
    signIn(makePlayer());
    await expect(requireAnyAdmin()).rejects.toThrow(AuthError);
    await expect(requireAnyAdmin()).rejects.toMatchObject({ statusCode: 403 });
  });

  it('rejects a player whose last resource-admin assignment was removed', async () => {
    signIn(makePlayer({ isResourceAdmin: true }), makePlayer({ isResourceAdmin: false }));
    await expect(requireAnyAdmin()).rejects.toMatchObject({ statusCode: 403 });
  });
});

// ── requireResourceAdmin ────────────────────────────────────────────

const RES_ID = '5a0b7f0e-1c2d-4e3f-8a9b-0c1d2e3f4a5b';
const SEASON_ID = '6b1c8a1f-2d3e-4f50-9b0c-1d2e3f4a5b6c';

describe('requireResourceAdmin', () => {
  it.each([
    ['season', 'INVALID_SEASON_ID', 'League not found'],
    ['tournament', 'INVALID_TOURNAMENT_ID', 'Tournament not found'],
  ] as const)('answers 404 %s for a malformed id without the resource read, site admins included', async (type, code, message) => {
    for (const player of [makePlayer({ isAdmin: true }), makePlayer({ isResourceAdmin: true })]) {
      signIn(player);
      const err = await requireResourceAdmin(type, "x' OR '1'='1").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UserFacingError);
      expect(err).toMatchObject({ statusCode: 404, code, message });
    }
    expect(isResourceAdminFor).not.toHaveBeenCalled();
  });

  it('still answers 401 for a malformed id when nobody is signed in (auth first)', async () => {
    mockedAuth.mockResolvedValue(null);
    await expect(requireResourceAdmin('season', 'bad')).rejects.toMatchObject({ statusCode: 401 });
  });

  it('passes for site admin without checking resource', async () => {
    signIn(makePlayer({ isAdmin: true }));

    const result = await requireResourceAdmin('tournament', RES_ID);
    expect(result.isAdmin).toBe(true);
    // Should not even call isResourceAdminFor
    expect(isResourceAdminFor).not.toHaveBeenCalled();
  });

  it('passes for resource admin with matching access', async () => {
    signIn(makePlayer({ isResourceAdmin: true }));
    vi.mocked(isResourceAdminFor).mockResolvedValue(true);

    const result = await requireResourceAdmin('tournament', RES_ID);
    expect(result.playerId).toBe('player-1');
    expect(isResourceAdminFor).toHaveBeenCalledWith('player-1', 'tournament', RES_ID);
  });

  it('throws AuthError(403) when player has no access to resource', async () => {
    signIn(makePlayer());
    vi.mocked(isResourceAdminFor).mockResolvedValue(false);

    await expect(requireResourceAdmin('tournament', RES_ID)).rejects.toThrow(AuthError);
    await expect(requireResourceAdmin('tournament', RES_ID)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('throws AuthError(401) when not authenticated', async () => {
    mockedAuth.mockResolvedValue(null);
    await expect(requireResourceAdmin('season', RES_ID)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('works with season resource type', async () => {
    signIn(makePlayer());
    vi.mocked(isResourceAdminFor).mockResolvedValue(true);

    const result = await requireResourceAdmin('season', SEASON_ID);
    expect(isResourceAdminFor).toHaveBeenCalledWith('player-1', 'season', SEASON_ID);
    expect(result.playerId).toBe('player-1');
  });

  it('checks a revoked site admin against the resource instead of passing them', async () => {
    signIn(makePlayer({ isAdmin: true }), makePlayer({ isAdmin: false }));
    vi.mocked(isResourceAdminFor).mockResolvedValue(false);

    await expect(requireResourceAdmin('season', SEASON_ID)).rejects.toMatchObject({ statusCode: 403 });
    expect(isResourceAdminFor).toHaveBeenCalledWith('player-1', 'season', SEASON_ID);
  });

  it('uses the live player id for the resource check', async () => {
    signIn(makePlayer({ playerId: 'stale-id' }), makePlayer({ playerId: 'live-id' }));
    vi.mocked(isResourceAdminFor).mockResolvedValue(true);

    await requireResourceAdmin('tournament', RES_ID);
    expect(isResourceAdminFor).toHaveBeenCalledWith('live-id', 'tournament', RES_ID);
  });

  it('rejects a banned resource admin before the resource check', async () => {
    signIn(makePlayer({ isResourceAdmin: true }), makePlayer({ isResourceAdmin: true, status: 'banned' }));
    await expect(requireResourceAdmin('season', SEASON_ID)).rejects.toMatchObject({ statusCode: 403 });
    expect(isResourceAdminFor).not.toHaveBeenCalled();
  });
});

// ── requireDraftAdmin ───────────────────────────────────────────────

type DraftPool = Awaited<ReturnType<typeof getDraftPoolById>>;

const POOL_ID = '0b6f2c1e-3d4a-4f5b-8c6d-7e8f9a0b1c2d';

describe('requireDraftAdmin', () => {
  it('passes for site admin without checking draft pool', async () => {
    signIn(makePlayer({ isAdmin: true }));

    const result = await requireDraftAdmin(POOL_ID);
    expect(result.isAdmin).toBe(true);
    expect(getDraftPoolById).not.toHaveBeenCalled();
  });

  it('passes when player is resource admin for the pool season', async () => {
    signIn(makePlayer());
    vi.mocked(getDraftPoolById).mockResolvedValue({
      id: 'pool-1',
      season_id: 'season-1',
    } as DraftPool);
    vi.mocked(isResourceAdminFor).mockResolvedValue(true);

    const result = await requireDraftAdmin(POOL_ID);
    expect(result.playerId).toBe('player-1');
    expect(getDraftPoolById).toHaveBeenCalledWith(POOL_ID);
    expect(isResourceAdminFor).toHaveBeenCalledWith('player-1', 'season', 'season-1');
  });

  it('throws a coded 404 POOL_NOT_FOUND when the draft pool is not found', async () => {
    signIn(makePlayer());
    vi.mocked(getDraftPoolById).mockResolvedValue(null as DraftPool);

    await expect(requireDraftAdmin(POOL_ID)).rejects.toThrow(UserFacingError);
    await expect(requireDraftAdmin(POOL_ID)).rejects.toMatchObject({
      message: 'Draft pool not found',
      statusCode: 404,
      code: 'POOL_NOT_FOUND',
    });
  });

  it('answers the same 404 for a malformed pool id without querying the database', async () => {
    signIn(makePlayer());

    for (const id of ['pool-1', '', "x' or 1=1", `${POOL_ID}x`]) {
      await expect(requireDraftAdmin(id)).rejects.toMatchObject({
        message: 'Draft pool not found',
        statusCode: 404,
        code: 'POOL_NOT_FOUND',
      });
    }
    expect(getDraftPoolById).not.toHaveBeenCalled();
    expect(isResourceAdminFor).not.toHaveBeenCalled();
  });

  it('safeErrorResponse forwards the unknown-pool code and keeps the English text', async () => {
    signIn(makePlayer());
    const err = await requireDraftAdmin('not-a-uuid').catch((e: unknown) => e);
    const res = safeErrorResponse(err, 'fallback');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Draft pool not found', code: 'POOL_NOT_FOUND' });
  });

  it('answers the same 404 to a site admin for a malformed id (the route would otherwise 500 on its uuid filter)', async () => {
    signIn(makePlayer({ isAdmin: true }));
    await expect(requireDraftAdmin('pool-1')).rejects.toMatchObject({ statusCode: 404, code: 'POOL_NOT_FOUND' });
    expect(getDraftPoolById).not.toHaveBeenCalled();
  });

  it('still passes a site admin for a well-formed id without the pool read', async () => {
    signIn(makePlayer({ isAdmin: true }));
    await expect(requireDraftAdmin(POOL_ID)).resolves.toMatchObject({ isAdmin: true });
    expect(getDraftPoolById).not.toHaveBeenCalled();
  });

  it('throws AuthError(403) when player has no season admin access', async () => {
    signIn(makePlayer());
    vi.mocked(getDraftPoolById).mockResolvedValue({
      id: 'pool-1',
      season_id: 'season-1',
    } as DraftPool);
    vi.mocked(isResourceAdminFor).mockResolvedValue(false);

    await expect(requireDraftAdmin(POOL_ID)).rejects.toThrow(AuthError);
    await expect(requireDraftAdmin(POOL_ID)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('throws AuthError(401) when not authenticated', async () => {
    mockedAuth.mockResolvedValue(null);
    await expect(requireDraftAdmin(POOL_ID)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('does not pass a revoked site admin without the season check', async () => {
    signIn(makePlayer({ isAdmin: true }), makePlayer({ isAdmin: false }));
    vi.mocked(getDraftPoolById).mockResolvedValue({
      id: 'pool-1',
      season_id: 'season-1',
    } as DraftPool);
    vi.mocked(isResourceAdminFor).mockResolvedValue(false);

    await expect(requireDraftAdmin(POOL_ID)).rejects.toMatchObject({ statusCode: 403 });
  });
});
