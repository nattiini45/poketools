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

const { captured, mockAuth } = vi.hoisted(() => ({
  captured: { config: null as NextAuthConfig | null },
  mockAuth: vi.fn(),
}));

vi.mock('next-auth', () => ({
  default: vi.fn((config: NextAuthConfig) => {
    captured.config = config;
    return { handlers: {}, auth: mockAuth, signIn: vi.fn(), signOut: vi.fn() };
  }),
}));
vi.mock('next-auth/providers/discord', () => ({
  default: vi.fn((options: Record<string, unknown>) => ({ id: 'discord', ...options })),
}));
vi.mock('next-auth/providers/credentials', () => ({
  default: vi.fn((options: Record<string, unknown>) => ({ id: 'credentials', ...options })),
}));
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
vi.mock('@/lib/pkmn/sprite-style-signin.server', () => ({ syncSpriteStyleCookieAtSignIn: vi.fn() }));
vi.mock('@/lib/supabase/queries/players', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/supabase/queries/players')>();
  return {
    // toSessionPlayer stays real: the token shape is part of what is tested.
    toSessionPlayer: actual.toSessionPlayer,
    getSessionPlayerRowByIdentity: vi.fn(),
    getPlayerByDiscordId: vi.fn(),
    isAuthUserLinkedToDiscordId: vi.fn(),
    createPlayer: vi.fn(),
    updatePlayer: vi.fn(),
    linkDiscordToPlayer: vi.fn(),
  };
});

import * as React from 'react';
import { cookies } from 'next/headers';
import { syncSpriteStyleCookieAtSignIn } from '@/lib/pkmn/sprite-style-signin.server';
import { verifyLinkToken } from '@/lib/utils/crypto';
import {
  getSessionPlayerRowByIdentity,
  getPlayerByDiscordId,
  isAuthUserLinkedToDiscordId,
  createPlayer,
  updatePlayer,
  linkDiscordToPlayer,
} from '@/lib/supabase/queries/players';
import {
  LINK_DISCORD_COOKIE,
  SESSION_PLAYER_TTL_MS,
  isSessionRefreshDue,
  loadSessionPlayer,
} from '@/auth';
import { SessionRevokedError } from '@/lib/auth/session-epoch';

const mockedRead = vi.mocked(getSessionPlayerRowByIdentity);
const mockedCreate = vi.mocked(createPlayer);
const mockedUpdate = vi.mocked(updatePlayer);
const mockedSpriteSync = vi.mocked(syncSpriteStyleCookieAtSignIn);
const mockedCookies = vi.mocked(cookies);
const mockedVerifyLink = vi.mocked(verifyLinkToken);
const mockedGetByDiscord = vi.mocked(getPlayerByDiscordId);
const mockedLink = vi.mocked(linkDiscordToPlayer);
const mockedIsLinked = vi.mocked(isAuthUserLinkedToDiscordId);

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

/** The jwt callback's raw answer: null ends the session (Auth.js clears the cookie). */
async function runJwtRaw(params: Partial<JwtParams> & { token: JWT }): Promise<JWT | null> {
  const jwt = config().callbacks?.jwt;
  if (!jwt) throw new Error('jwt callback missing');
  return jwt({ user: undefined as unknown as JwtParams['user'], ...params } as JwtParams);
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
    sessions_valid_after: '-infinity',
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

describe('Discord provider config', () => {
  it('takes the client id and secret from the validated Discord env group', () => {
    const discord = (config().providers as unknown as Array<Record<string, unknown>>).find((p) => p.id === 'discord');
    expect(discord).toMatchObject({
      clientId: 'test-DISCORD_CLIENT_ID',
      clientSecret: 'test-DISCORD_CLIENT_SECRET',
    });
  });

  it("expects Discord's issuer, so the iss parameter Discord sends on the callback validates", () => {
    const discord = (config().providers as unknown as Array<Record<string, unknown>>).find((p) => p.id === 'discord');
    expect(discord?.issuer).toBe('https://discord.com');
  });
});

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
    // Sign-in syncs the sprite-style cookie from the existing account.
    expect(mockedSpriteSync).toHaveBeenCalledWith('player-1', { created: false });
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
    // A new account may adopt the style chosen while signed out.
    expect(mockedSpriteSync).toHaveBeenCalledWith('player-new', { created: true });
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
    expect(mockedSpriteSync).toHaveBeenCalledWith('player-1', { created: false });
  });

  it('a failed sprite-style sync is logged in full and refuses the sign-in (never masked)', async () => {
    mockedRead.mockResolvedValue(makeRow());
    const failure = new Error('players read failed');
    mockedSpriteSync.mockRejectedValueOnce(failure);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      runJwt({
        token: {},
        account: discordAccount,
        profile: { id: 'discord-1', username: 'ash' },
        trigger: 'signIn',
      }),
    ).rejects.toBe(failure);

    expect(errorLog).toHaveBeenCalledWith(expect.stringMatching(/sprite style cookie sync at sign-in failed/), failure);
  });

  it('a failed credentials sign-in sync is rethrown too', async () => {
    mockedRead.mockResolvedValue(makeRow());
    const failure = new Error('cookie write failed');
    mockedSpriteSync.mockRejectedValueOnce(failure);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      runJwt({
        token: {},
        account: { provider: 'credentials', type: 'credentials', providerAccountId: 'auth-uuid-1' } as JwtParams['account'],
        user: { id: 'auth-uuid-1', email: 'ash@example.test', name: 'Ash' },
        trigger: 'signIn',
      }),
    ).rejects.toBe(failure);
  });

  it('a session refresh never touches the sprite-style cookie', async () => {
    mockedRead.mockResolvedValue(makeRow());
    await runJwt({ token: discordToken({ refreshedAt: NOW - SESSION_PLAYER_TTL_MS }) });
    expect(mockedRead).toHaveBeenCalledTimes(1);
    expect(mockedSpriteSync).not.toHaveBeenCalled();
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
    expect(mockedSpriteSync).not.toHaveBeenCalled();

    mockedRead.mockResolvedValue(makeRow());
    const next = await runJwt({ token: signedIn });
    expect(next.player).toEqual(makeSessionPlayer());
  });
});

// ── credentials superadmin binding (GoTrue signup is public) ────────

describe('credentials superadmin binding', () => {
  const RESERVED = 'operator@example.test';
  const OPERATOR_DISCORD_ID = '111122223333444455';
  const credentialsAccount = {
    provider: 'credentials',
    type: 'credentials',
    providerAccountId: 'auth-uuid-1',
  } as JwtParams['account'];
  const signIn = (email = RESERVED) =>
    runJwt({
      token: {},
      account: credentialsAccount,
      user: { id: 'auth-uuid-1', email, name: 'Operator' },
      trigger: 'signIn',
    });
  const created = (): Player => ({
    id: 'player-new',
    name: 'Operator',
    discord_id: null,
    auth_user_id: 'auth-uuid-1',
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
  });

  beforeEach(() => {
    process.env.SUPERADMIN_EMAIL = RESERVED;
    process.env.SUPERADMIN_DISCORD_ID = OPERATOR_DISCORD_ID;
    mockedIsLinked.mockResolvedValue(false);
  });

  it('a brand-new player on the reserved email is not admin and is never promoted', async () => {
    mockedRead.mockResolvedValue(null);
    mockedCreate.mockResolvedValue(created());

    const result = await signIn();

    expect(mockedCreate).toHaveBeenCalledTimes(1);
    expect(result.player).toMatchObject({ playerId: 'player-new', isAdmin: false });
    expect(result.superadminLinked).toBe(false);
    expect(mockedIsLinked).not.toHaveBeenCalled();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('an existing player on the reserved email without the operator Discord link is not admin', async () => {
    mockedRead.mockResolvedValue(makeRow({ is_admin: false }));
    mockedIsLinked.mockResolvedValue(false);

    const result = await signIn();

    expect(mockedIsLinked).toHaveBeenCalledWith('auth-uuid-1', OPERATOR_DISCORD_ID);
    expect(result.player).toMatchObject({ isAdmin: false });
    expect(result.superadminLinked).toBe(false);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('the documented path: a player linked to SUPERADMIN_DISCORD_ID is superadmin and admin is persisted', async () => {
    mockedRead.mockResolvedValue(makeRow({ is_admin: false }));
    mockedIsLinked.mockResolvedValue(true);

    const result = await signIn();

    expect(result.player).toMatchObject({ isAdmin: true });
    expect(result.superadminLinked).toBe(true);
    expect(mockedUpdate).toHaveBeenCalledWith('player-1', { is_admin: true });
  });

  it('the email match is case- and whitespace-insensitive', async () => {
    mockedRead.mockResolvedValue(makeRow());
    mockedIsLinked.mockResolvedValue(true);

    const result = await signIn('  Operator@Example.TEST ');

    expect(result.superadminLinked).toBe(true);
  });

  it('with SUPERADMIN_DISCORD_ID unset no email session is superadmin, and nothing is read', async () => {
    delete process.env.SUPERADMIN_DISCORD_ID;
    mockedRead.mockResolvedValue(makeRow());
    mockedIsLinked.mockResolvedValue(true);

    const result = await signIn();

    expect(result.superadminLinked).toBe(false);
    expect(result.player).toMatchObject({ isAdmin: false });
    expect(mockedIsLinked).not.toHaveBeenCalled();
  });

  it('another email never reads the link, even when the player holds the operator Discord id', async () => {
    mockedRead.mockResolvedValue(makeRow());
    mockedIsLinked.mockResolvedValue(true);

    const result = await signIn('someone@example.test');

    expect(result.superadminLinked).toBe(false);
    expect(result.player).toMatchObject({ isAdmin: false });
    expect(mockedIsLinked).not.toHaveBeenCalled();
  });

  it('a failed link read fails the sign-in lookup closed: no player, no admin', async () => {
    mockedRead.mockResolvedValue(makeRow());
    mockedIsLinked.mockRejectedValue(new Error('timeout'));

    const result = await signIn();

    expect(result.player).toBeNull();
    expect(result.superadminLinked).toBeUndefined();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('the refresh recomputes the link: a link removed since sign-in drops superadmin', async () => {
    mockedRead.mockResolvedValue(makeRow({ is_admin: true }));
    mockedIsLinked.mockResolvedValue(false);
    const token = discordToken({
      id: 'auth-uuid-1',
      provider: 'credentials',
      email: RESERVED,
      superadminLinked: true,
      player: makeSessionPlayer({ isAdmin: true }),
      refreshedAt: undefined,
    });

    const result = await runJwt({ token });

    expect(mockedIsLinked).toHaveBeenCalledWith('auth-uuid-1', OPERATOR_DISCORD_ID);
    expect(result.superadminLinked).toBe(false);
    // The stored is_admin (granted earlier) is a role like any other; only the override stops applying.
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('the refresh keeps a linked superadmin', async () => {
    mockedRead.mockResolvedValue(makeRow({ is_admin: false }));
    mockedIsLinked.mockResolvedValue(true);
    const token = discordToken({
      id: 'auth-uuid-1',
      provider: 'credentials',
      email: RESERVED,
      refreshedAt: undefined,
    });

    const result = await runJwt({ token });

    expect(result.superadminLinked).toBe(true);
    expect(result.player).toMatchObject({ isAdmin: true });
  });

  it('a Discord session never carries or reads the credentials link', async () => {
    mockedRead.mockResolvedValue(makeRow());
    const result = await runJwt({ token: discordToken({ refreshedAt: undefined }) });
    expect(result.superadminLinked).toBeUndefined();
    expect(mockedIsLinked).not.toHaveBeenCalled();
  });

  it('the session carries the derived boolean and never the Discord id', async () => {
    const sessionCb = config().callbacks?.session;
    if (!sessionCb) throw new Error('session callback missing');
    const token = discordToken({ id: 'auth-uuid-1', provider: 'credentials', superadminLinked: true });

    const session = (await sessionCb({
      session: { user: { id: '', name: 'Operator', email: RESERVED, image: null }, expires: '2099-01-01' },
      token,
    } as unknown as Parameters<typeof sessionCb>[0])) as Session;

    expect(session.superadminLinked).toBe(true);
    expect(JSON.stringify(session)).not.toContain(OPERATOR_DISCORD_ID);
    expect(JSON.stringify(token)).not.toContain(OPERATOR_DISCORD_ID);
  });
});

// ── session epoch: authAt vs players.sessions_valid_after ───────────

describe('session epoch', () => {
  const discordAccount = { provider: 'discord', type: 'oauth', providerAccountId: 'discord-1' } as JwtParams['account'];
  const credentialsAccount = {
    provider: 'credentials',
    type: 'credentials',
    providerAccountId: 'auth-uuid-1',
  } as JwtParams['account'];
  const SIGNED_IN_AT = NOW - 3_600_000;
  const iso = (ms: number): string => new Date(ms).toISOString();
  const due = NOW - SESSION_PLAYER_TTL_MS - 1;

  it('stamps authAt at a Discord sign-in', async () => {
    mockedRead.mockResolvedValue(makeRow());
    const result = await runJwt({
      token: {},
      account: discordAccount,
      profile: { id: 'discord-1', username: 'ash' },
      trigger: 'signIn',
    });
    expect(result.authAt).toBe(NOW);
  });

  it('stamps authAt at a credentials sign-in', async () => {
    mockedRead.mockResolvedValue(makeRow());
    const result = await runJwt({
      token: {},
      account: credentialsAccount,
      user: { id: 'auth-uuid-1', email: 'ash@example.test', name: 'Ash' },
      trigger: 'signIn',
    });
    expect(result.authAt).toBe(NOW);
  });

  it('stamps a credentials sign-in with the time its attempt started, so one in flight across a reset predates the revocation', async () => {
    mockedRead.mockResolvedValue(makeRow());
    const startedAt = NOW - 2_500;
    const result = await runJwt({
      token: {},
      account: credentialsAccount,
      user: { id: 'auth-uuid-1', email: 'ash@example.test', name: 'Ash', authStartedAt: startedAt },
      trigger: 'signIn',
    });
    expect(result.authAt).toBe(startedAt);
  });

  it('ignores an attempt start time in the future', async () => {
    mockedRead.mockResolvedValue(makeRow());
    const result = await runJwt({
      token: {},
      account: credentialsAccount,
      user: { id: 'auth-uuid-1', email: 'ash@example.test', name: 'Ash', authStartedAt: NOW + 60_000 },
      trigger: 'signIn',
    });
    expect(result.authAt).toBe(NOW);
  });

  it('stamps authAt even when the sign-in lookup fails, so the next read can still be compared', async () => {
    mockedRead.mockRejectedValue(new Error('timeout'));
    const result = await runJwt({
      token: {},
      account: discordAccount,
      profile: { id: 'discord-1', username: 'ash' },
      trigger: 'signIn',
    });
    expect(result.authAt).toBe(NOW);
  });

  it('a sign-in is never revoked by an epoch that predates it', async () => {
    mockedRead.mockResolvedValue(makeRow({ sessions_valid_after: iso(NOW - 1_000) }));
    const result = await runJwt({
      token: {},
      account: discordAccount,
      profile: { id: 'discord-1', username: 'ash' },
      trigger: 'signIn',
    });
    expect(result.player).toEqual(makeSessionPlayer());
    expect(result.authAt).toBe(NOW);
  });

  it('a refresh and an update() never advance authAt, and token.iat is not used', async () => {
    mockedRead.mockResolvedValue(makeRow());
    const token = discordToken({ authAt: SIGNED_IN_AT, refreshedAt: due, iat: Math.floor(NOW / 1000) });

    const refreshed = await runJwt({ token });
    expect(refreshed.authAt).toBe(SIGNED_IN_AT);

    const updated = await runJwt({ token: { ...refreshed }, trigger: 'update' });
    expect(updated.authAt).toBe(SIGNED_IN_AT);
  });

  it('decides on authAt, never on token.iat (iat moves on every re-encode)', async () => {
    // The epoch is after the sign-in and before iat: only authAt may decide.
    mockedRead.mockResolvedValue(makeRow({ sessions_valid_after: iso(NOW - 60_000) }));
    const token = discordToken({ authAt: SIGNED_IN_AT, refreshedAt: due, iat: Math.floor(NOW / 1000) });
    expect(await runJwtRaw({ token })).toBeNull();
  });

  it('keeps a token issued after the epoch', async () => {
    mockedRead.mockResolvedValue(makeRow({ sessions_valid_after: iso(SIGNED_IN_AT - 1) }));
    const result = await runJwt({ token: discordToken({ authAt: SIGNED_IN_AT, refreshedAt: due }) });
    expect(result.player).toEqual(makeSessionPlayer());
  });

  it('keeps a token issued at the very epoch', async () => {
    mockedRead.mockResolvedValue(makeRow({ sessions_valid_after: iso(SIGNED_IN_AT) }));
    const result = await runJwt({ token: discordToken({ authAt: SIGNED_IN_AT, refreshedAt: due }) });
    expect(result.player).toEqual(makeSessionPlayer());
  });

  it('ends the session (jwt returns null) when the epoch is after the sign-in', async () => {
    mockedRead.mockResolvedValue(makeRow({ sessions_valid_after: iso(SIGNED_IN_AT + 1) }));
    expect(await runJwtRaw({ token: discordToken({ authAt: SIGNED_IN_AT, refreshedAt: due }) })).toBeNull();
  });

  it('ends a credentials session the same way, and a forced update() reads it at once', async () => {
    mockedRead.mockResolvedValue(makeRow({ sessions_valid_after: iso(SIGNED_IN_AT + 1) }));
    const token = discordToken({
      id: 'auth-uuid-1',
      provider: 'credentials',
      authAt: SIGNED_IN_AT,
      refreshedAt: NOW - 1_000,
    });
    expect(await runJwtRaw({ token, trigger: 'update' })).toBeNull();
  });

  it('accepts a legacy token (no authAt) while the epoch is -infinity', async () => {
    mockedRead.mockResolvedValue(makeRow({ sessions_valid_after: '-infinity' }));
    const result = await runJwt({ token: discordToken({ refreshedAt: due }) });
    expect(result.player).toEqual(makeSessionPlayer());
    expect(result.authAt).toBeUndefined();
  });

  it('revokes a legacy token (no authAt) once the epoch has been bumped', async () => {
    mockedRead.mockResolvedValue(makeRow({ sessions_valid_after: iso(NOW - 86_400_000) }));
    expect(await runJwtRaw({ token: discordToken({ refreshedAt: due }) })).toBeNull();
  });

  it('a token inside the TTL is not re-read; the live guards catch a revocation in that window', async () => {
    mockedRead.mockResolvedValue(makeRow({ sessions_valid_after: iso(NOW) }));
    const token = discordToken({ authAt: SIGNED_IN_AT, refreshedAt: NOW - 1_000 });
    const result = await runJwt({ token });
    expect(mockedRead).not.toHaveBeenCalled();
    expect(result.authAt).toBe(SIGNED_IN_AT);
  });

  it('a Discord session of a player whose epoch moved (a password reset) ends too', async () => {
    mockedRead.mockResolvedValue(makeRow({ sessions_valid_after: iso(SIGNED_IN_AT + 5_000) }));
    expect(await runJwtRaw({ token: discordToken({ authAt: SIGNED_IN_AT, refreshedAt: due }) })).toBeNull();
  });

  it('an unreadable epoch fails like a failed read: the stale copy stays and the next call retries', async () => {
    mockedRead.mockResolvedValue(makeRow({ sessions_valid_after: 'garbage' }));
    const token = discordToken({ authAt: SIGNED_IN_AT, refreshedAt: due });
    const result = await runJwt({ token });
    expect(result.refreshedAt).toBe(due);
  });

  it('the session lasts 14 days', () => {
    expect(config().session?.maxAge).toBe(14 * 24 * 60 * 60);
  });

  describe('loadSessionPlayer with a sign-in time', () => {
    it('throws SessionRevokedError for a token older than the epoch, and returns no player', async () => {
      mockedRead.mockResolvedValue(makeRow({ sessions_valid_after: iso(SIGNED_IN_AT + 1) }));
      await expect(loadSessionPlayer('discord', 'discord-1', { authAt: SIGNED_IN_AT })).rejects.toBeInstanceOf(
        SessionRevokedError,
      );
    });

    it('returns the player for a token at or after the epoch', async () => {
      mockedRead.mockResolvedValue(makeRow({ sessions_valid_after: iso(SIGNED_IN_AT) }));
      await expect(loadSessionPlayer('discord', 'discord-1', { authAt: SIGNED_IN_AT })).resolves.toEqual(
        makeSessionPlayer(),
      );
    });

    it('treats a missing authAt as a legacy token: valid at -infinity, revoked once bumped', async () => {
      mockedRead.mockResolvedValue(makeRow());
      await expect(loadSessionPlayer('discord', 'discord-1', { authAt: undefined })).resolves.toEqual(
        makeSessionPlayer(),
      );
      mockedRead.mockResolvedValue(makeRow({ sessions_valid_after: iso(SIGNED_IN_AT) }));
      await expect(loadSessionPlayer('discord', 'discord-1', { authAt: undefined })).rejects.toBeInstanceOf(
        SessionRevokedError,
      );
    });

    it('still answers null, not a revocation, when the identity has no player', async () => {
      mockedRead.mockResolvedValue(null);
      await expect(loadSessionPlayer('discord', 'discord-1', { authAt: SIGNED_IN_AT })).resolves.toBeNull();
    });

    it('does not compare without a sign-in time argument (no token to judge)', async () => {
      mockedRead.mockResolvedValue(makeRow({ sessions_valid_after: iso(NOW) }));
      await expect(loadSessionPlayer('discord', 'discord-1')).resolves.toEqual(makeSessionPlayer());
    });
  });
});

// ── session callback ────────────────────────────────────────────────

describe('session callback', () => {
  it('carries authAt so the live guards can compare it with the epoch', async () => {
    const sessionCb = config().callbacks?.session;
    if (!sessionCb) throw new Error('session callback missing');

    const withStamp = (await sessionCb({
      session: { user: { id: '', name: 'Ash', email: null, image: null }, expires: '2099-01-01' },
      token: discordToken({ authAt: NOW - 5_000 }),
    } as unknown as Parameters<typeof sessionCb>[0])) as Session;
    expect(withStamp.authAt).toBe(NOW - 5_000);

    const legacy = (await sessionCb({
      session: { user: { id: '', name: 'Ash', email: null, image: null }, expires: '2099-01-01' },
      token: discordToken(),
    } as unknown as Parameters<typeof sessionCb>[0])) as Session;
    expect(legacy.authAt).toBeUndefined();
  });

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

// ── signIn callback: Discord link intent ────────────────────────────

describe('signIn callback link intent', () => {
  type SignInParams = Parameters<NonNullable<Callbacks['signIn']>>[0];

  const cookieGet = vi.fn();
  const cookieDelete = vi.fn();

  beforeEach(() => {
    cookieGet.mockReturnValue({ name: LINK_DISCORD_COOKIE, value: 'signed-intent' });
    mockedCookies.mockResolvedValue({ get: cookieGet, delete: cookieDelete } as unknown as Awaited<ReturnType<typeof cookies>>);
    mockedVerifyLink.mockReturnValue('P');
    mockedGetByDiscord.mockResolvedValue(null);
  });

  async function runSignIn(): Promise<string | boolean> {
    const signInCb = config().callbacks?.signIn;
    if (!signInCb) throw new Error('signIn callback missing');
    return signInCb({
      account: { provider: 'discord', type: 'oauth', providerAccountId: 'D2' },
      profile: { id: 'D2' },
      user: { id: 'D2' },
    } as unknown as SignInParams);
  }

  const SIGNED_IN_AT = NOW - 60_000;

  /** The session `auth()` answers from the cookie: a cached player copy plus the identity and sign-in time. */
  function liveSession(overrides?: Record<string, unknown>): Record<string, unknown> {
    return {
      user: { id: 'auth-uuid-1' },
      provider: 'credentials',
      authAt: SIGNED_IN_AT,
      player: makeSessionPlayer({ playerId: 'P' }),
      ...overrides,
    };
  }

  function expectIntentConsumed(): void {
    expect(cookieDelete).toHaveBeenCalledWith(expect.objectContaining({ name: LINK_DISCORD_COOKIE, path: '/' }));
  }

  it('uses an unprefixed cookie name outside production (__Host- needs Secure)', () => {
    expect(LINK_DISCORD_COOKIE).toBe('poketools_link_discord');
  });

  it('refuses the link when no session is live on the request', async () => {
    mockAuth.mockResolvedValue(null);

    await expect(runSignIn()).resolves.toBe('/auth/error?error=LinkExpired');

    expectIntentConsumed();
    expect(mockedLink).not.toHaveBeenCalled();
    expect(mockedGetByDiscord).not.toHaveBeenCalled();
  });

  it('refuses the link when the live session belongs to another player', async () => {
    mockAuth.mockResolvedValue(liveSession());
    mockedRead.mockResolvedValue(makeRow({ id: 'Q' }));

    await expect(runSignIn()).resolves.toBe('/auth/error?error=LinkExpired');

    expectIntentConsumed();
    expect(mockedLink).not.toHaveBeenCalled();
  });

  it('refuses the link when the identity has no player row now', async () => {
    mockAuth.mockResolvedValue(liveSession());
    mockedRead.mockResolvedValue(null);

    await expect(runSignIn()).resolves.toBe('/auth/error?error=LinkExpired');
    expect(mockedLink).not.toHaveBeenCalled();
  });

  it('refuses the link for a cached, not-yet-due session that an advanced cutoff has revoked', async () => {
    // The cached copy still names player P and is far inside the TTL, so auth()
    // answers it without a read. Only the live epoch says it is dead.
    mockAuth.mockResolvedValue(liveSession({ player: makeSessionPlayer({ playerId: 'P' }) }));
    mockedRead.mockResolvedValue(makeRow({ id: 'P', sessions_valid_after: new Date(SIGNED_IN_AT + 1).toISOString() }));

    await expect(runSignIn()).resolves.toBe('/auth/error?error=LinkExpired');

    expectIntentConsumed();
    expect(mockedLink).not.toHaveBeenCalled();
    expect(mockedGetByDiscord).not.toHaveBeenCalled();
  });

  it('treats a session without a sign-in time as revoked once any cutoff exists', async () => {
    mockAuth.mockResolvedValue(liveSession({ authAt: undefined }));
    mockedRead.mockResolvedValue(makeRow({ id: 'P', sessions_valid_after: new Date(NOW - 1_000).toISOString() }));

    await expect(runSignIn()).resolves.toBe('/auth/error?error=LinkExpired');
    expect(mockedLink).not.toHaveBeenCalled();
  });

  it.each(['banned', 'suspended'] as const)('refuses the link when the live player is %s', async (status) => {
    mockAuth.mockResolvedValue(liveSession());
    mockedRead.mockResolvedValue(makeRow({ id: 'P', status }));

    await expect(runSignIn()).resolves.toBe('/auth/error?error=LinkExpired');
    expect(mockedLink).not.toHaveBeenCalled();
  });

  it('lets a site admin link even when flagged suspended, as the guards do', async () => {
    mockAuth.mockResolvedValue(liveSession());
    mockedRead.mockResolvedValue(makeRow({ id: 'P', status: 'suspended', is_admin: true }));

    await expect(runSignIn()).resolves.toBe(true);
    expect(mockedLink).toHaveBeenCalledWith('P', 'D2');
  });

  it('fails closed when the live read throws', async () => {
    mockAuth.mockResolvedValue(liveSession());
    mockedRead.mockRejectedValue(new Error('db down'));

    await expect(runSignIn()).resolves.toBe('/auth/error?error=Default');

    expectIntentConsumed();
    expect(mockedLink).not.toHaveBeenCalled();
  });

  it('reads the player live for the session identity, not from the cached copy', async () => {
    mockAuth.mockResolvedValue(liveSession());
    mockedRead.mockResolvedValue(makeRow({ id: 'P' }));

    await runSignIn();

    expect(mockedRead).toHaveBeenCalledWith('credentials', 'auth-uuid-1');
  });

  it('fails closed when the session check throws', async () => {
    mockAuth.mockRejectedValue(new Error('jwt decode failed'));

    await expect(runSignIn()).resolves.toBe('/auth/error?error=Default');

    expectIntentConsumed();
    expect(mockedLink).not.toHaveBeenCalled();
  });

  it('links Discord when the minting player is still signed in', async () => {
    mockAuth.mockResolvedValue(liveSession());
    mockedRead.mockResolvedValue(makeRow({ id: 'P' }));

    await expect(runSignIn()).resolves.toBe(true);

    expectIntentConsumed();
    expect(mockedLink).toHaveBeenCalledWith('P', 'D2');
  });

  it('a forged or expired intent is refused before the session is read', async () => {
    mockedVerifyLink.mockReturnValue(null);

    await expect(runSignIn()).resolves.toBe('/auth/error?error=LinkExpired');

    expectIntentConsumed();
    expect(mockAuth).not.toHaveBeenCalled();
    expect(mockedLink).not.toHaveBeenCalled();
  });

  it('a Discord sign-in without an intent never reads the session', async () => {
    cookieGet.mockReturnValue(undefined);

    await expect(runSignIn()).resolves.toBe(true);

    expect(cookieDelete).not.toHaveBeenCalled();
    expect(mockAuth).not.toHaveBeenCalled();
  });

  it('sign-out clears a pending intent', async () => {
    const signOutEvent = config().events?.signOut;
    if (!signOutEvent) throw new Error('signOut event missing');

    await signOutEvent({ token: discordToken() } as Parameters<typeof signOutEvent>[0]);

    expectIntentConsumed();
  });
});
