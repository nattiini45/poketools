import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from 'next-auth';

// ── React: the react-server build, so cache() really memoises per render ─────
// (same stand-in as helpers.test.ts: vitest resolves 'react' to the client build, whose cache() is a pass-through)
vi.mock('react', async () => {
  const { createRequire } = await import('node:module');
  const path = await import('node:path');
  const nodeRequire = createRequire(import.meta.url);
  const reactDir = path.dirname(nodeRequire.resolve('react/package.json'));
  return nodeRequire(path.join(reactDir, 'cjs', 'react.react-server.development.js'));
});

vi.mock('@/auth', () => ({
  auth: vi.fn(),
  loadSessionPlayer: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/resource-admins', () => ({ isResourceAdminFor: vi.fn() }));
vi.mock('@/lib/supabase/queries/drafts', () => ({ getDraftPoolById: vi.fn() }));
vi.mock('@/lib/supabase/queries/format-definitions', () => ({ getFormatDefinitionMeta: vi.fn() }));

import * as React from 'react';
import { auth } from '@/auth';
import { getSession } from '../helpers';
import {
  authAndRecord,
  getVerifiedSession,
  recordAuthSession,
  runAsVerifiedSession,
} from '../session-override';

const mockedAuth = vi.mocked(auth) as unknown as ReturnType<typeof vi.fn<() => Promise<Session | null>>>;

function makeSession(id: string, overrides: Partial<Session> = {}): Session {
  return {
    user: { id, name: id, email: `${id}@example.com`, image: null },
    player: null,
    expires: '2099-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** A session the way the chat and approve routes get one: through the wrapped auth(). */
async function recorded(id: string, overrides: Partial<Session> = {}): Promise<Session> {
  const session = makeSession(id, overrides);
  mockedAuth.mockResolvedValueOnce(session);
  const got = await authAndRecord();
  if (got === null) throw new Error('expected a session');
  return got;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedAuth.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getVerifiedSession', () => {
  it('is undefined outside runAsVerifiedSession', () => {
    expect(getVerifiedSession()).toBeUndefined();
  });
});

describe('authAndRecord', () => {
  it('returns the exact object auth() returned and records it, so a run may use it', async () => {
    const session = makeSession('a');
    mockedAuth.mockResolvedValueOnce(session);
    const got = await authAndRecord();
    expect(got).toBe(session);
    await expect(runAsVerifiedSession(session, async () => getVerifiedSession())).resolves.toBe(session);
  });

  it('returns null and records nothing when nobody is signed in', async () => {
    mockedAuth.mockResolvedValueOnce(null);
    await expect(authAndRecord()).resolves.toBeNull();
  });

  it('rethrows an auth() failure', async () => {
    const boom = new Error('jwt');
    mockedAuth.mockRejectedValueOnce(boom);
    await expect(authAndRecord()).rejects.toBe(boom);
  });
});

describe('runAsVerifiedSession: only sessions that auth() returned may enter', () => {
  it('refuses a hand-built session, before fn starts', () => {
    const fn = vi.fn(async () => 'ran');
    expect(() => runAsVerifiedSession(makeSession('forged'), fn)).toThrow(/not returned by auth\(\)/);
    expect(fn).not.toHaveBeenCalled();
  });

  it('refuses a copy of a recorded session (spread, JSON round trip, structured clone)', async () => {
    const session = await recorded('a');
    const fn = vi.fn(async () => 'ran');
    expect(() => runAsVerifiedSession({ ...session }, fn)).toThrow(/not returned by auth\(\)/);
    expect(() => runAsVerifiedSession(JSON.parse(JSON.stringify(session)) as Session, fn)).toThrow(/not returned by auth\(\)/);
    expect(() => runAsVerifiedSession(structuredClone(session), fn)).toThrow(/not returned by auth\(\)/);
    expect(fn).not.toHaveBeenCalled();
  });

  it('refuses a session that was never recorded even when it is a copy of the recorded one with the same identity', async () => {
    await recorded('a');
    expect(() => runAsVerifiedSession(makeSession('a'), async () => 1)).toThrow(/not returned by auth\(\)/);
  });

  it('accepts a session recorded directly (the entry authAndRecord uses)', async () => {
    const session = makeSession('direct');
    recordAuthSession(session);
    await expect(runAsVerifiedSession(session, async () => getVerifiedSession())).resolves.toBe(session);
  });
});

describe('runAsVerifiedSession: expiry', () => {
  it('refuses a session whose expires has passed', async () => {
    const session = await recorded('old', { expires: '2000-01-01T00:00:00.000Z' });
    const fn = vi.fn(async () => 'ran');
    expect(() => runAsVerifiedSession(session, fn)).toThrow(/expired/);
    expect(fn).not.toHaveBeenCalled();
  });

  it('checks the clock on every run: valid before the expiry, refused at and after it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const session = await recorded('timed', { expires: '2030-01-01T00:00:00.000Z' });

    vi.setSystemTime(new Date('2029-12-31T23:59:59.000Z'));
    await expect(runAsVerifiedSession(session, async () => 'ok')).resolves.toBe('ok');

    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    expect(() => runAsVerifiedSession(session, async () => 'late')).toThrow(/expired/);

    vi.setSystemTime(new Date('2031-01-01T00:00:00.000Z'));
    expect(() => runAsVerifiedSession(session, async () => 'later')).toThrow(/expired/);
  });

  it('fails closed on an unreadable or missing expires', async () => {
    const garbled = await recorded('garbled', { expires: 'not a date' });
    expect(() => runAsVerifiedSession(garbled, async () => 1)).toThrow(/expired/);
    const missing = await recorded('missing', { expires: undefined as unknown as string });
    expect(() => runAsVerifiedSession(missing, async () => 1)).toThrow(/expired/);
  });
});

describe('runAsVerifiedSession: the scope', () => {
  it('holds across awaits and timers, and is gone afterwards', async () => {
    const session = await recorded('a');
    const seen: Array<Session | undefined> = [];
    await runAsVerifiedSession(session, async () => {
      seen.push(getVerifiedSession());
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      seen.push(getVerifiedSession());
      await Promise.all([Promise.resolve().then(() => seen.push(getVerifiedSession()))]);
    });
    expect(seen).toEqual([session, session, session]);
    expect(seen.every((s) => s === session)).toBe(true);
    expect(getVerifiedSession()).toBeUndefined();
  });

  it('keeps concurrent runs apart', async () => {
    const a = await recorded('a');
    const b = await recorded('b');
    const seen = await Promise.all([
      runAsVerifiedSession(a, async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
        return getVerifiedSession();
      }),
      runAsVerifiedSession(b, async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 1));
        return getVerifiedSession();
      }),
    ]);
    expect(seen[0]).toBe(a);
    expect(seen[1]).toBe(b);
  });

  it('lets an inner run win and restores the outer one', async () => {
    const outer = await recorded('outer');
    const inner = await recorded('inner');
    const seen: Array<Session | undefined> = [];
    await runAsVerifiedSession(outer, async () => {
      seen.push(getVerifiedSession());
      await runAsVerifiedSession(inner, async () => {
        seen.push(getVerifiedSession());
      });
      seen.push(getVerifiedSession());
    });
    expect(seen).toEqual([outer, inner, outer]);
  });

  it('an inner run still needs a recorded session', async () => {
    const outer = await recorded('outer');
    await expect(
      runAsVerifiedSession(outer, async () => runAsVerifiedSession(makeSession('forged'), async () => 1)),
    ).rejects.toThrow(/not returned by auth\(\)/);
  });

  it('passes fn\'s result and its rejection through, and leaves no scope behind either way', async () => {
    const session = await recorded('a');
    await expect(runAsVerifiedSession(session, async () => 42)).resolves.toBe(42);
    const boom = new Error('boom');
    await expect(runAsVerifiedSession(session, async () => { throw boom; })).rejects.toBe(boom);
    expect(getVerifiedSession()).toBeUndefined();
  });
});

// ── getSession: the override is read outside React cache() ───────────────────

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

describe('getSession with the override', () => {
  afterEach(() => {
    serverInternals.A = null;
  });

  it('answers the verified session inside a run without calling auth(), and auth() outside it', async () => {
    const cookie = makeSession('cookie');
    const verified = await recorded('verified');
    mockedAuth.mockReset();
    mockedAuth.mockResolvedValue(cookie);

    await expect(runAsVerifiedSession(verified, () => getSession())).resolves.toBe(verified);
    expect(mockedAuth).not.toHaveBeenCalled();
    await expect(getSession()).resolves.toBe(cookie);
    expect(mockedAuth).toHaveBeenCalledTimes(1);
  });

  it('answers the verified session even when the cookie holds nobody (the dispatch case)', async () => {
    const verified = await recorded('verified');
    mockedAuth.mockReset();
    mockedAuth.mockResolvedValue(null);
    await expect(runAsVerifiedSession(verified, () => getSession())).resolves.toBe(verified);
    await expect(getSession()).resolves.toBeNull();
  });

  it('keeps the memoisation of auth() inside one render', async () => {
    const cookie = makeSession('cookie');
    mockedAuth.mockResolvedValue(cookie);
    await inRender(async () => {
      expect(await getSession()).toBe(cookie);
      expect(await getSession()).toBe(cookie);
    });
    expect(mockedAuth).toHaveBeenCalledTimes(1);
  });

  it('never memoises the override into the render cache: the ambient answer before and after is auth()\'s', async () => {
    const cookie = makeSession('cookie');
    const verified = await recorded('verified');
    mockedAuth.mockReset();
    mockedAuth.mockResolvedValue(cookie);

    await inRender(async () => {
      expect(await getSession()).toBe(cookie);
      expect(await runAsVerifiedSession(verified, () => getSession())).toBe(verified);
      expect(await getSession()).toBe(cookie);
    });
    expect(mockedAuth).toHaveBeenCalledTimes(1);
  });

  it('an override entered before the first ambient call does not poison the cache either', async () => {
    const cookie = makeSession('cookie');
    const verified = await recorded('verified');
    mockedAuth.mockReset();
    mockedAuth.mockResolvedValue(cookie);

    await inRender(async () => {
      expect(await runAsVerifiedSession(verified, () => getSession())).toBe(verified);
      expect(mockedAuth).not.toHaveBeenCalled();
      expect(await getSession()).toBe(cookie);
      expect(await getSession()).toBe(cookie);
    });
    expect(mockedAuth).toHaveBeenCalledTimes(1);
  });
});
