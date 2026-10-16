import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextAuthConfig } from 'next-auth';
import type { JWT } from '@auth/core/jwt';
import type { Session } from 'next-auth';
import type { SessionPlayer } from '@/types/auth';
import type { Player } from '@/types/player';
import type { SessionPlayerRow } from '@/lib/supabase/queries/players';

// ── React: the react-server build, so cache() memoises per render ─────
// (see src/lib/auth/__tests__/helpers.test.ts for the rationale)
vi.mock('react', async () => {
  const { createRequire } = await import('node:module');
  const path = await import('node:path');
  const nodeRequire = createRequire(import.meta.url);
  const reactDir = path.dirname(nodeRequire.resolve('react/package.json'));
  return nodeRequire(path.join(reactDir, 'cjs', 'react.react-server.development.js'));
});

// ── Capture the NextAuth config so the callbacks can be driven directly ──

const { captured } = vi.hoisted(() => ({
  captured: { config: null as NextAuthConfig | null },
}));

vi.mock('next-auth', () => ({
  default: vi.fn((config: NextAuthConfig) => {
    captured.config = config;
    return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
  }),
}));
vi.mock('next-auth/providers/discord', () => ({
  default: vi.fn((options: Record<string, unknown>) => ({ id: 'discord', ...options })),
}));
vi.mock('next-auth/providers/credentials', () => ({
  default: vi.fn((options: Record<string, unknown>) => ({ id: 'credentials', ...options })),
}));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('@/lib/env', () => ({ requireEnv: (name: string) => `test-${name}` }));
vi.mock('@/lib/auth/credentials', () => ({ authorizeCredentials: vi.fn() }));
vi.mock('@/lib/utils/crypto', () => ({ verifyLinkToken: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/supabase/queries/players', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/supabase/queries/players')>();
  return {
    // toSessionPlayer stays real: the token shape is part of what is tested.
    toSessionPlayer: actual.toSessionPlayer,
    getSessionPlayerRowByIdentity: vi.fn(),
    getPlayerByDiscordId: vi.fn(),
    createPlayer: vi.fn(),
    updatePlayer: vi.fn(),
    linkDiscordToPlayer: vi.fn(),
  };
});

import * as React from 'react';
import {
  getSessionPlayerRowByIdentity,
  createPlayer,
  updatePlayer,
} from '@/lib/supabase/queries/players';
import {
  SESSION_PLAYER_TTL_MS,
  isSessionRefreshDue,
  loadSessionPlayer,
} from '@/auth';

const mockedRead = vi.mocked(getSessionPlayerRowByIdentity);
const mockedCreate = vi.mocked(createPlayer);
const mockedUpdate = vi.mocked(updatePlayer);

type Callbacks = NonNullable<NextAuthConfig['callbacks']>;
type JwtParams = Parameters<NonNullable<Callbacks['jwt']>>[0];

function config(): NextAuthConfig {
  if (!captured.config) throw new Error('NextAuth config was not captured');
  return captured.config;
}

async function runJwt(params: Partial<JwtParams> & { token: JWT }): Promise<JWT> {
  const jwt = config().callbacks?.jwt;
  if (!jwt) throw new Error('jwt callback missing');
  const result = await jwt({ user: undefined as unknown as JwtParams['user'], ...params } as JwtParams);
  if (!result) throw new Error('jwt callback returned null');
  return result;
}

// ── Render scope (stand-in for the Flight request dispatcher) ────────

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

// ── Fixtures ─────────────────────────────────────────────────────────

const NOW = Date.UTC(2026, 8, 29, 12, 0, 0);

function makeRow(overrides?: Partial<SessionPlayerRow>): SessionPlayerRow {
  return {
    id: 'player-1',
    name: 'Ash',
    is_admin: false,
    is_creator: false,
    ps_username: 'ash_ps',
    champions_username: 'ash_ch',
    avatar_url: null,
    status: 'active',
    resource_admin_count: 0,
    ...overrides,
  };
}

function makeSessionPlayer(overrides?: Partial<SessionPlayer>): SessionPlayer {
  return {
    playerId: 'player-1',
    name: 'Ash',
    isAdmin: false,
    isResourceAdmin: false,
    isCreator: false,
    psUsername: 'ash_ps',
    championsUsername: 'ash_ch',
    avatarUrl: null,
    status: 'active',
    ...overrides,
  };
}

function discordToken(overrides?: Partial<JWT>): JWT {
  return {
    id: 'discord-1',
    provider: 'discord',
    player: makeSessionPlayer(),
    refreshedAt: NOW - 60_000,
    ...overrides,
  };
}

const SESSION_PLAYER_KEYS = [
  'avatarUrl',
  'championsUsername',
  'isAdmin',
  'isCreator',
  'isResourceAdmin',
  'name',
  'playerId',
  'psUsername',
  'status',
];

beforeEach(async () => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  delete process.env.SUPERADMIN_DISCORD_ID;
  delete process.env.SUPERADMIN_EMAIL;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  // Importing '@/auth' above ran NextAuth(config); make sure it was captured.
  expect(captured.config).not.toBeNull();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  serverInternals.A = null;
});

// ── isSessionRefreshDue ─────────────────────────────────────────────

describe('isSessionRefreshDue', () => {
  it('is not due inside the 5-minute TTL', () => {
    expect(SESSION_PLAYER_TTL_MS).toBe(5 * 60 * 1000);
    expect(isSessionRefreshDue(NOW - 1, NOW)).toBe(false);
    expect(isSessionRefreshDue(NOW - SESSION_PLAYER_TTL_MS + 1, NOW)).toBe(false);
  });

  it('is due at and past the TTL', () => {
    expect(isSessionRefreshDue(NOW - SESSION_PLAYER_TTL_MS, NOW)).toBe(true);
    expect(isSessionRefreshDue(NOW - SESSION_PLAYER_TTL_MS - 1, NOW)).toBe(true);
  });

  it('is due when the timestamp is missing or malformed', () => {
    expect(isSessionRefreshDue(undefined, NOW)).toBe(true);
    expect(isSessionRefreshDue('1700000000000', NOW)).toBe(true);
    expect(isSessionRefreshDue(Number.NaN, NOW)).toBe(true);
    expect(isSessionRefreshDue(Number.POSITIVE_INFINITY, NOW)).toBe(true);
  });

  it('tolerates small clock skew but re-reads a timestamp far in the future', () => {
    expect(isSessionRefreshDue(NOW + 5_000, NOW)).toBe(false);
    expect(isSessionRefreshDue(NOW + SESSION_PLAYER_TTL_MS + 1, NOW)).toBe(true);
  });
});

// ── jwt callback: refresh TTL (D37) ─────────────────────────────────

describe('jwt callback refresh', () => {
  it('does not read the DB within the TTL', async () => {
    const token = discordToken({ refreshedAt: NOW - (SESSION_PLAYER_TTL_MS - 1_000) });
    const player = token.player;

    const result = await runJwt({ token });

    expect(mockedRead).not.toHaveBeenCalled();
    expect(result.player).toBe(player);
    expect(result.refreshedAt).toBe(NOW - (SESSION_PLAYER_TTL_MS - 1_000));
  });

  it('reads once past the TTL, with the resource-admin count folded into that read', async () => {
    mockedRead.mockResolvedValue(makeRow({ name: 'Ash Renamed', resource_admin_count: 2 }));
    const token = discordToken({ refreshedAt: NOW - SESSION_PLAYER_TTL_MS - 1 });

    const result = await runJwt({ token });

    expect(mockedRead).toHaveBeenCalledTimes(1);
    expect(mockedRead).toHaveBeenCalledWith('discord', 'discord-1');
    expect(result.player).toEqual(makeSessionPlayer({ name: 'Ash Renamed', isResourceAdmin: true }));
    expect(result.refreshedAt).toBe(NOW);
  });

  it('reads on trigger "update" even within the TTL', async () => {
    mockedRead.mockResolvedValue(makeRow({ avatar_url: 'https://example.test/a.png' }));
    const token = discordToken({ refreshedAt: NOW - 1_000 });

    const result = await runJwt({ token, trigger: 'update' });

    expect(mockedRead).toHaveBeenCalledTimes(1);
    expect(result.player).toMatchObject({ avatarUrl: 'https://example.test/a.png' });
    expect(result.refreshedAt).toBe(NOW);
  });

  it('ignores client-supplied data on trigger "update": the player comes only from the DB', async () => {
    mockedRead.mockResolvedValue(makeRow({ is_admin: false }));
    const token = discordToken();

    const result = await runJwt({
      token,
      trigger: 'update',
      session: { player: { isAdmin: true, status: 'active' } },
    });

    expect(result.player).toMatchObject({ isAdmin: false });
  });

  it('reads a legacy token that has no refreshedAt', async () => {
    mockedRead.mockResolvedValue(makeRow());
    const token = discordToken({ refreshedAt: undefined });

    const result = await runJwt({ token });

    expect(mockedRead).toHaveBeenCalledTimes(1);
    expect(result.refreshedAt).toBe(NOW);
  });

  it('treats a legacy token without a provider as discord', async () => {
    mockedRead.mockResolvedValue(makeRow());
    await runJwt({ token: discordToken({ provider: undefined, refreshedAt: undefined }) });
    expect(mockedRead).toHaveBeenCalledWith('discord', 'discord-1');
  });

  it('reads credentials identities by auth user id', async () => {
    mockedRead.mockResolvedValue(makeRow());
    await runJwt({
      token: discordToken({ id: 'auth-uuid-1', provider: 'credentials', refreshedAt: undefined }),
    });
    expect(mockedRead).toHaveBeenCalledWith('credentials', 'auth-uuid-1');
  });

  it('keeps the stale copy and does not advance refreshedAt when the read fails', async () => {
    mockedRead.mockRejectedValue(new Error('connection refused'));
    const token = discordToken({ refreshedAt: NOW - SESSION_PLAYER_TTL_MS - 1 });
    const player = token.player;

    const result = await runJwt({ token });

    expect(result.player).toBe(player);
    expect(result.refreshedAt).toBe(NOW - SESSION_PLAYER_TTL_MS - 1);
    expect(console.warn).toHaveBeenCalledWith(
      '[auth] jwt callback player refresh failed:',
      'connection refused'
    );
  });

  it('drops the player copy when the identity no longer has a player', async () => {
    mockedRead.mockResolvedValue(null);
    const token = discordToken({ player: makeSessionPlayer({ isAdmin: true }), refreshedAt: undefined });

    const result = await runJwt({ token });

    expect(result.player).toBeNull();
    expect(result.refreshedAt).toBe(NOW);
  });

  it('applies the superadmin override on refresh and persists is_admin', async () => {
    process.env.SUPERADMIN_DISCORD_ID = 'discord-1';
    mockedRead.mockResolvedValue(makeRow({ is_admin: false }));

    const result = await runJwt({ token: discordToken({ refreshedAt: undefined }) });

    expect(result.player).toMatchObject({ isAdmin: true });
    expect(mockedUpdate).toHaveBeenCalledWith('player-1', { is_admin: true });
  });

  it('does nothing for a token without an identity', async () => {
    const result = await runJwt({ token: {} });
    expect(mockedRead).not.toHaveBeenCalled();
    expect(result).toEqual({});
  });
});

// ── jwt callback: sign-in ───────────────────────────────────────────

describe('jwt callback sign-in', () => {
  const discordAccount = { provider: 'discord', type: 'oauth', providerAccountId: 'discord-1' } as JwtParams['account'];

  it('Discord sign-in of an existing player: one narrow read, refreshedAt set', async () => {
    mockedRead.mockResolvedValue(makeRow({ resource_admin_count: 1 }));

    const result = await runJwt({
      token: {},
      account: discordAccount,
      profile: { id: 'discord-1', username: 'ash' },
      trigger: 'signIn',
    });

    expect(mockedRead).toHaveBeenCalledTimes(1);
    expect(mockedRead).toHaveBeenCalledWith('discord', 'discord-1');
    expect(mockedCreate).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: 'discord-1', provider: 'discord', refreshedAt: NOW });
    expect(result.player).toEqual(makeSessionPlayer({ isResourceAdmin: true }));
  });

  it('Discord sign-in of a new player creates it; the token holds only SessionPlayer fields', async () => {
    mockedRead.mockResolvedValue(null);
    const created: Player = {
      id: 'player-new',
      name: 'ash',
      discord_id: 'discord-1',
      auth_user_id: null,
      ps_username: '',
      champions_username: '',
      is_admin: false,
      is_creator: false,
      is_guest: false,
      is_test_account: false,
      joined_date: '2026-09-29',
      avatar_url: null,
      avatar_config: null,
      status: 'active',
      suspended_until: null,
      ban_reason: null,
      created_at: '2026-09-29T12:00:00Z',
      updated_at: '2026-09-29T12:00:00Z',
    };
    mockedCreate.mockResolvedValue(created);

    const result = await runJwt({
      token: {},
      account: discordAccount,
      profile: { id: 'discord-1', username: 'ash' },
      trigger: 'signUp',
    });

    expect(mockedCreate).toHaveBeenCalledWith({ name: 'ash', discord_id: 'discord-1' });
    expect(result.player).toMatchObject({ playerId: 'player-new', isResourceAdmin: false });
    expect(Object.keys(result.player ?? {}).sort()).toEqual(SESSION_PLAYER_KEYS);
    expect(result.refreshedAt).toBe(NOW);
  });

  it('credentials sign-in reads by auth user id', async () => {
    mockedRead.mockResolvedValue(makeRow());

    const result = await runJwt({
      token: {},
      account: { provider: 'credentials', type: 'credentials', providerAccountId: 'auth-uuid-1' } as JwtParams['account'],
      user: { id: 'auth-uuid-1', email: 'ash@example.test', name: 'Ash' },
      trigger: 'signIn',
    });

    expect(mockedRead).toHaveBeenCalledWith('credentials', 'auth-uuid-1');
    expect(result).toMatchObject({ id: 'auth-uuid-1', provider: 'credentials', refreshedAt: NOW });
  });

  it('a failed sign-in lookup leaves no player and no timestamp, so the next call retries', async () => {
    mockedRead.mockRejectedValue(new Error('timeout'));

    const signedIn = await runJwt({
      token: {},
      account: discordAccount,
      profile: { id: 'discord-1', username: 'ash' },
      trigger: 'signIn',
    });

    expect(signedIn.player).toBeNull();
    expect(signedIn.refreshedAt).toBeUndefined();

    mockedRead.mockResolvedValue(makeRow());
    const next = await runJwt({ token: signedIn });
    expect(next.player).toEqual(makeSessionPlayer());
  });
});

// ── session callback ────────────────────────────────────────────────

describe('session callback', () => {
  it('exposes the player and provider but never the refresh timestamp', async () => {
    const sessionCb = config().callbacks?.session;
    if (!sessionCb) throw new Error('session callback missing');
    const token = discordToken();

    const session = (await sessionCb({
      session: { user: { id: '', name: 'Ash', email: null, image: null }, expires: '2099-01-01' },
      token,
    } as unknown as Parameters<typeof sessionCb>[0])) as Session;

    expect(session.player).toEqual(token.player);
    expect(session.provider).toBe('discord');
    expect(session.user.id).toBe('discord-1');
    expect(JSON.stringify(session)).not.toContain('refreshedAt');
  });
});

// ── loadSessionPlayer: one read per render ──────────────────────────

describe('loadSessionPlayer', () => {
  it('reads the DB once per render for the same identity and returns fresh objects', async () => {
    mockedRead.mockResolvedValue(makeRow());

    const [a, b] = await inRender(async () => [
      await loadSessionPlayer('discord', 'discord-1'),
      await loadSessionPlayer('discord', 'discord-1'),
    ]);

    expect(mockedRead).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it('a token refresh and a guard in the same render share one read', async () => {
    mockedRead.mockResolvedValue(makeRow());

    await inRender(async () => {
      await runJwt({ token: discordToken({ refreshedAt: undefined }) });
      await loadSessionPlayer('discord', 'discord-1');
    });

    expect(mockedRead).toHaveBeenCalledTimes(1);
  });

  it('reads on every call outside a render (route handlers)', async () => {
    mockedRead.mockResolvedValue(makeRow());
    await loadSessionPlayer('discord', 'discord-1');
    await loadSessionPlayer('discord', 'discord-1');
    expect(mockedRead).toHaveBeenCalledTimes(2);
  });

  it('returns null when the identity has no player', async () => {
    mockedRead.mockResolvedValue(null);
    expect(await loadSessionPlayer('credentials', 'auth-uuid-1')).toBeNull();
  });
});
