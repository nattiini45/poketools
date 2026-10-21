/**
 * The live view gate end to end: the real helpers over the real `@/auth`
 * (loadSessionPlayer and its per-render cache), with only NextAuth and the
 * narrow player query mocked. It proves the admin layout gate, AdminGuard and
 * a guard in one render cost exactly one DB read, and that a revoked admin is
 * refused on the very next render.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Session } from 'next-auth';
import type { SessionPlayerRow } from '@/lib/supabase/queries/players';

// React: the react-server build, so cache() memoises per render
// (see helpers.test.ts for the rationale).
vi.mock('react', async () => {
  const { createRequire } = await import('node:module');
  const path = await import('node:path');
  const nodeRequire = createRequire(import.meta.url);
  const reactDir = path.dirname(nodeRequire.resolve('react/package.json'));
  return nodeRequire(path.join(reactDir, 'cjs', 'react.react-server.development.js'));
});

const { nextAuthAuth } = vi.hoisted(() => ({ nextAuthAuth: { fn: null as null | ((...a: unknown[]) => unknown) } }));

vi.mock('next-auth', () => ({
  default: vi.fn(() => {
    const auth = vi.fn();
    nextAuthAuth.fn = auth;
    return { handlers: {}, auth, signIn: vi.fn(), signOut: vi.fn() };
  }),
}));
vi.mock('next-auth/providers/discord', () => ({ default: vi.fn(() => ({ id: 'discord' })) }));
vi.mock('next-auth/providers/credentials', () => ({ default: vi.fn(() => ({ id: 'credentials' })) }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('@/lib/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  requireEnv: (name: string) => `test-${name}`,
  readEnv: (schema: { shape: object }) =>
    Object.fromEntries(Object.keys(schema.shape).map((name) => [name, `test-${name}`])),
}));
vi.mock('@/lib/auth/credentials', () => ({ authorizeCredentials: vi.fn() }));
vi.mock('@/lib/utils/crypto', () => ({ verifyLinkToken: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/supabase/queries/resource-admins', () => ({ isResourceAdminFor: vi.fn() }));
vi.mock('@/lib/supabase/queries/drafts', () => ({ getDraftPoolById: vi.fn() }));
vi.mock('@/lib/supabase/queries/players', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/supabase/queries/players')>();
  return {
    toSessionPlayer: actual.toSessionPlayer,
    getSessionPlayerRowByIdentity: vi.fn(),
    getPlayerByDiscordId: vi.fn(),
    createPlayer: vi.fn(),
    updatePlayer: vi.fn(),
    linkDiscordToPlayer: vi.fn(),
  };
});

import * as React from 'react';
import { getSessionPlayerRowByIdentity } from '@/lib/supabase/queries/players';
import { getLiveAccess, requireAdmin, getSession, isAdmin } from '../helpers';

const mockedRead = vi.mocked(getSessionPlayerRowByIdentity);

interface CacheDispatcher {
  getCacheForType: <T>(createCache: () => T) => T;
}

const serverInternals = (
  React as unknown as {
    __SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: { A: CacheDispatcher | null };
  }
).__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

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

function row(overrides?: Partial<SessionPlayerRow>): SessionPlayerRow {
  return {
    id: 'player-1',
    name: 'Ash',
    is_admin: true,
    is_creator: false,
    ps_username: '',
    champions_username: '',
    avatar_url: null,
    status: 'active',
    resource_admin_count: 0,
    ...overrides,
  };
}

/** A token minted while the player was still an admin. */
const adminTokenSession: Session = {
  user: { id: 'discord-1', name: 'Ash', email: null, image: null },
  player: {
    playerId: 'player-1',
    name: 'Ash',
    isAdmin: true,
    isResourceAdmin: false,
    isCreator: false,
    psUsername: '',
    championsUsername: '',
    avatarUrl: null,
    status: 'active',
  },
  provider: 'discord',
  expires: '2099-01-01',
};

beforeEach(() => {
  vi.clearAllMocks();
  if (!nextAuthAuth.fn) throw new Error('NextAuth auth() was not captured');
  vi.mocked(nextAuthAuth.fn).mockResolvedValue(adminTokenSession);
});

afterEach(() => {
  serverInternals.A = null;
});

describe('live view gate in one server render', () => {
  it('admin layout, AdminGuard and requireAdmin cost one auth() and one DB read', async () => {
    mockedRead.mockResolvedValue(row());

    const [layout, guard, guarded] = await inRender(async () => [
      await getLiveAccess(),
      await getLiveAccess(),
      await requireAdmin(),
    ]);

    expect(layout?.isSiteAdmin).toBe(true);
    expect(guard?.isAnyAdmin).toBe(true);
    expect(guarded.isAdmin).toBe(true);
    expect(nextAuthAuth.fn).toHaveBeenCalledTimes(1);
    expect(mockedRead).toHaveBeenCalledTimes(1);
    expect(mockedRead).toHaveBeenCalledWith('discord', 'discord-1');
  });

  it('a revoked admin is refused on the next render, while the token still says admin', async () => {
    mockedRead.mockResolvedValue(row());
    expect((await inRender(() => getLiveAccess()))?.isAnyAdmin).toBe(true);

    // Admin rights revoked in the DB; the cookie is unchanged.
    mockedRead.mockResolvedValue(row({ is_admin: false }));

    const access = await inRender(async () => {
      expect(isAdmin(await getSession())).toBe(true); // stale token copy
      return getLiveAccess();
    });
    expect(access).toMatchObject({ isSiteAdmin: false, isAnyAdmin: false, isCreator: false });
    await expect(inRender(() => requireAdmin())).rejects.toMatchObject({ statusCode: 403 });
  });

  it('each render reads again (no cross-request reuse)', async () => {
    mockedRead.mockResolvedValue(row());
    await inRender(() => getLiveAccess());
    await inRender(() => getLiveAccess());
    expect(mockedRead).toHaveBeenCalledTimes(2);
  });
});
