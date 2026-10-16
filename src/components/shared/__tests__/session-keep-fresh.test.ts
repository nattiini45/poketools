import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// SessionProvider.tsx imports next-auth/react; the loop under test does not use it.
vi.mock('next-auth/react', () => ({
  SessionProvider: () => null,
  useSession: vi.fn(),
}));

// '@/auth' is imported for the real SESSION_PLAYER_TTL_MS and
// isSessionRefreshDue, so the tests bind the client interval to the server
// TTL. Mock what it pulls in (same set as src/__tests__/auth.test.ts).
vi.mock('next-auth', () => ({
  default: vi.fn(() => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() })),
}));
vi.mock('next-auth/providers/discord', () => ({ default: vi.fn(() => ({ id: 'discord' })) }));
vi.mock('next-auth/providers/credentials', () => ({ default: vi.fn(() => ({ id: 'credentials' })) }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('@/lib/env', () => ({ requireEnv: (name: string) => `test-${name}` }));
vi.mock('@/lib/auth/credentials', () => ({ authorizeCredentials: vi.fn() }));
vi.mock('@/lib/utils/crypto', () => ({ verifyLinkToken: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/supabase/queries/players', () => ({
  toSessionPlayer: vi.fn(),
  getSessionPlayerRowByIdentity: vi.fn(),
  getPlayerByDiscordId: vi.fn(),
  createPlayer: vi.fn(),
  updatePlayer: vi.fn(),
  linkDiscordToPlayer: vi.fn(),
}));

import type { Session } from 'next-auth';
import { SESSION_PLAYER_TTL_MS, isSessionRefreshDue } from '@/auth';
import {
  CLIENT_SESSION_PLAYER_TTL_MS,
  SESSION_KEEP_FRESH_INTERVAL_MS,
  SESSION_KEEP_FRESH_RETRY_MS,
  SESSION_SELF_EDIT_REFRESH_TIMEOUT_MS,
  startSessionKeepFresh,
  requestSessionRefresh,
  refreshSessionPlayerNow,
  type RefreshStamp,
} from '../SessionProvider';

const START = Date.UTC(2026, 8, 29, 12, 0, 0);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const SESSION: Session = {
  user: { id: 'discord-1', name: 'Ash', email: null, image: null },
  player: null,
  expires: '2099-01-01',
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Deterministic pseudo-random in [0, 1). */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** A shared stamp, as localStorage is shared between tabs. */
function sharedStamp(initial: number | null = null): RefreshStamp & { value: number | null } {
  const stamp = {
    value: initial,
    read: () => stamp.value,
    write: (at: number) => {
      stamp.value = at;
    },
  };
  return stamp;
}

/**
 * The server side of the session cookie. `forcedRefresh` is a POST to
 * /api/auth/session (trigger 'update'): it re-reads the player when the
 * request arrives and rewrites the cookie. `refreshedAt` is what every server
 * auth() checks with isSessionRefreshDue().
 */
function fakeServer(initialAgeMs: number, latency: () => number) {
  const server = {
    refreshedAt: Date.now() - initialAgeMs,
    reads: [] as number[],
    forcedRefresh: vi.fn(async () => {
      await sleep(latency()); // request
      server.refreshedAt = Date.now();
      server.reads.push(server.refreshedAt);
      await sleep(latency()); // response
      return true;
    }),
  };
  return server;
}

/**
 * The longest time the token spent past its TTL between `from` and `to`,
 * computed exactly from the refresh times (the token ages linearly between
 * refreshes, so it is due exactly when a gap reaches the TTL).
 */
function totalDueMs(initialRefreshedAt: number, reads: number[], to: number): number {
  const points = [initialRefreshedAt, ...reads, to];
  let due = 0;
  for (let i = 1; i < points.length; i++) {
    due += Math.max(0, points[i] - points[i - 1] - SESSION_PLAYER_TTL_MS);
  }
  return due;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('keep-fresh constants', () => {
  it('match the server TTL and refresh a full minute inside it', () => {
    expect(CLIENT_SESSION_PLAYER_TTL_MS).toBe(SESSION_PLAYER_TTL_MS);
    expect(SESSION_PLAYER_TTL_MS - SESSION_KEEP_FRESH_INTERVAL_MS).toBeGreaterThanOrEqual(MINUTE);
    expect(SESSION_KEEP_FRESH_RETRY_MS).toBeLessThan(SESSION_KEEP_FRESH_INTERVAL_MS);
  });
});

describe('long-lived tab: server auth() is never due between refreshes', () => {
  it('8 hours with jittered latency (up to 3 s each way): zero due time, one read per interval', async () => {
    const rand = seeded(42);
    // Worst case at mount: the token is 10 s short of its TTL.
    const server = fakeServer(SESSION_PLAYER_TTL_MS - 10_000, () => 20 + rand() * 3_000);
    const initialRefreshedAt = server.refreshedAt;
    const loop = startSessionKeepFresh({ refresh: server.forcedRefresh, stamp: sharedStamp() });

    // Spot checks every 10 s, as a server render or API call would do.
    let dueChecks = 0;
    for (let elapsed = 0; elapsed < 8 * HOUR; elapsed += 10_000) {
      await vi.advanceTimersByTimeAsync(10_000);
      if (isSessionRefreshDue(server.refreshedAt, Date.now())) dueChecks++;
    }
    loop.stop();

    expect(dueChecks).toBe(0);
    expect(totalDueMs(initialRefreshedAt, server.reads, Date.now())).toBe(0);
    // The longest gap between two re-reads stays well inside the TTL.
    const gaps = server.reads.slice(1).map((at, i) => at - server.reads[i]);
    expect(Math.max(...gaps)).toBeLessThan(SESSION_PLAYER_TTL_MS - 50_000);
    // One narrow read per 4-minute interval (plus the one at mount).
    const expected = (8 * HOUR) / SESSION_KEEP_FRESH_INTERVAL_MS;
    expect(server.reads.length).toBeGreaterThanOrEqual(expected - 1);
    expect(server.reads.length).toBeLessThanOrEqual(expected + 1);
  });

  it('for contrast, the old 300 s GET poll (re-read only when due) leaves the token due for whole cycles', async () => {
    const rand = seeded(42);
    const latency = () => 20 + rand() * 3_000;
    const server = { refreshedAt: Date.now() - (SESSION_PLAYER_TTL_MS - 10_000), reads: [] as number[] };
    const initialRefreshedAt = server.refreshedAt;
    const poll = setInterval(async () => {
      await sleep(latency());
      if (isSessionRefreshDue(server.refreshedAt, Date.now())) {
        server.refreshedAt = Date.now();
        server.reads.push(server.refreshedAt);
      }
    }, 300_000);

    await vi.advanceTimersByTimeAsync(8 * HOUR);
    clearInterval(poll);

    // A poll that arrives a little earlier than the last one finds the token
    // not yet due, so it stays past its TTL until the next poll.
    expect(totalDueMs(initialRefreshedAt, server.reads, Date.now())).toBeGreaterThan(HOUR);
  });
});

describe('startSessionKeepFresh', () => {
  it('refreshes at once when no refresh is on record, then every interval', async () => {
    const refresh = vi.fn(async () => true);
    const stamp = sharedStamp();
    const loop = startSessionKeepFresh({ refresh, stamp });

    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(stamp.value).toBe(START);

    await vi.advanceTimersByTimeAsync(SESSION_KEEP_FRESH_INTERVAL_MS - 1);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(2);
    loop.stop();
  });

  it('does not refresh at mount after a recent refresh, and waits out the rest of the interval', async () => {
    const refresh = vi.fn(async () => true);
    const loop = startSessionKeepFresh({ refresh, stamp: sharedStamp(START - 3 * MINUTE) });

    await vi.advanceTimersByTimeAsync(MINUTE - 1);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    loop.stop();
  });

  it('stamps the time the refresh started, not when it answered', async () => {
    const stamp = sharedStamp();
    const loop = startSessionKeepFresh({
      refresh: async () => {
        await sleep(2_000);
        return true;
      },
      stamp,
    });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(stamp.value).toBe(START);
    loop.stop();
  });

  it('three tabs sharing the stamp cost one read per interval between them', async () => {
    const stamp = sharedStamp();
    const refresh = vi.fn(async () => {
      await sleep(150);
      return true;
    });
    const loops = [startSessionKeepFresh({ refresh, stamp })];
    await vi.advanceTimersByTimeAsync(37_000);
    loops.push(startSessionKeepFresh({ refresh, stamp }));
    await vi.advanceTimersByTimeAsync(95_000);
    loops.push(startSessionKeepFresh({ refresh, stamp }));

    await vi.advanceTimersByTimeAsync(HOUR);
    loops.forEach((loop) => loop.stop());

    const intervals = (HOUR + 132_000) / SESSION_KEEP_FRESH_INTERVAL_MS;
    expect(refresh.mock.calls.length).toBeLessThanOrEqual(Math.ceil(intervals) + 1);
  });

  it('a hidden or offline tab makes no request, and refreshes at once when it can again', async () => {
    let visible = false;
    const refresh = vi.fn(async () => true);
    const loop = startSessionKeepFresh({
      refresh,
      canRefresh: () => visible,
      stamp: sharedStamp(START - 10 * MINUTE),
    });

    await vi.advanceTimersByTimeAsync(20 * MINUTE);
    expect(refresh).not.toHaveBeenCalled();

    visible = true;
    loop.check(); // visibilitychange / online
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    loop.stop();
  });

  it('a hidden tab whose visibilitychange never arrives still refreshes within the retry delay', async () => {
    let visible = false;
    const refresh = vi.fn(async () => true);
    const loop = startSessionKeepFresh({
      refresh,
      canRefresh: () => visible,
      stamp: sharedStamp(START - 10 * MINUTE),
    });

    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(refresh).not.toHaveBeenCalled();

    visible = true; // no loop.check(): the event was missed
    await vi.advanceTimersByTimeAsync(SESSION_KEEP_FRESH_RETRY_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    loop.stop();
  });

  it('check() inside the interval does not refresh again', async () => {
    const refresh = vi.fn(async () => true);
    const loop = startSessionKeepFresh({ refresh, stamp: sharedStamp() });
    await vi.advanceTimersByTimeAsync(MINUTE);
    loop.check();
    loop.check();
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    loop.stop();
  });

  it('a failed refresh retries after the retry delay, never in a tight loop, despite its own claim', async () => {
    const refresh = vi.fn(async () => false);
    const stamp = sharedStamp();
    const loop = startSessionKeepFresh({ refresh, stamp });

    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    loop.stop();

    expect(refresh).toHaveBeenCalledTimes(1 + (5 * MINUTE) / SESSION_KEEP_FRESH_RETRY_MS);
    // The last attempt's claim: other tabs keep waiting while this one retries.
    expect(stamp.value).toBe(START + 5 * MINUTE);
  });

  it("a tab that falls due while another tab's refresh is in flight waits (the stamp is claimed first)", async () => {
    const stamp = sharedStamp(START - 10 * MINUTE);
    const slow = vi.fn(async () => {
      await sleep(5_000);
      return true;
    });
    const other = vi.fn(async () => true);
    const tabA = startSessionKeepFresh({ refresh: slow, stamp });
    const tabB = startSessionKeepFresh({ refresh: other, stamp }); // same instant, A in flight

    await vi.advanceTimersByTimeAsync(5_000);
    expect(slow).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
    tabA.stop();
    tabB.stop();
  });

  it("after a failure, another tab takes over once the failed claim's interval ends", async () => {
    const stamp = sharedStamp();
    const failing = startSessionKeepFresh({ refresh: async () => false, stamp });
    failing.stop(); // the failing tab closes right after its failed attempt
    const healthy = vi.fn(async () => true);
    const loop = startSessionKeepFresh({ refresh: healthy, stamp });

    await vi.advanceTimersByTimeAsync(SESSION_KEEP_FRESH_INTERVAL_MS - 1);
    expect(healthy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(healthy).toHaveBeenCalledTimes(1);
    loop.stop();
  });

  it('a rejected refresh counts as a failure', async () => {
    const refresh = vi.fn(async () => {
      throw new Error('network');
    });
    const loop = startSessionKeepFresh({ refresh, stamp: sharedStamp() });
    await vi.advanceTimersByTimeAsync(SESSION_KEEP_FRESH_RETRY_MS);
    loop.stop();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('a stamp from the future (clock change) counts as due', async () => {
    const refresh = vi.fn(async () => true);
    const loop = startSessionKeepFresh({ refresh, stamp: sharedStamp(START + HOUR) });
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    loop.stop();
  });

  it('stop() cancels the timer; a refresh in flight still records its stamp but does not re-arm', async () => {
    const stamp = sharedStamp();
    const refresh = vi.fn(async () => {
      await sleep(1_000);
      return true;
    });
    const loop = startSessionKeepFresh({ refresh, stamp });
    loop.stop();
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(stamp.value).toBe(START);
  });
});

describe('requestSessionRefresh', () => {
  it('sends update({}), a POST with trigger "update"; a bare update() would be a GET that re-reads nothing', async () => {
    const update = vi.fn(async () => SESSION);
    expect(await requestSessionRefresh(update)).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({});
  });

  it('is false, and never throws, when no session comes back or update rejects', async () => {
    expect(await requestSessionRefresh(vi.fn(async () => null))).toBe(false);
    expect(await requestSessionRefresh(vi.fn(async () => undefined as unknown as Session))).toBe(false);
    expect(
      await requestSessionRefresh(
        vi.fn(async () => {
          throw new Error('offline');
        })
      )
    ).toBe(false);
  });
});

describe('refreshSessionPlayerNow (self-edit refresh)', () => {
  it('retries while another update() is in flight, with the then-current update function', async () => {
    const busy = vi.fn(async () => undefined as unknown as Session); // next-auth: loading, returns nothing
    const ready = vi.fn(async () => SESSION);
    let current = busy;
    const stamp = sharedStamp();

    const result = refreshSessionPlayerNow(() => current, { stamp });
    await vi.advanceTimersByTimeAsync(0);
    expect(busy).toHaveBeenCalledTimes(1);

    current = ready; // the in-flight update finished and the provider re-rendered
    await vi.advanceTimersByTimeAsync(250);

    expect(await result).toBe(true);
    expect(ready).toHaveBeenCalledWith({});
    expect(stamp.value).toBe(START + 250);
  });

  it('gives up after three attempts and resolves false without throwing', async () => {
    const update = vi.fn(async () => null);
    const stamp = sharedStamp();
    const result = refreshSessionPlayerNow(() => update, { stamp });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await result).toBe(false);
    expect(update).toHaveBeenCalledTimes(3);
    expect(stamp.value).toBeNull();
  });

  it('resolves false at the deadline when the refresh stalls, without a further attempt', async () => {
    const stalled = vi.fn(() => new Promise<Session>(() => undefined)); // never answers
    const stamp = sharedStamp();
    let outcome: boolean | undefined;
    void refreshSessionPlayerNow(() => stalled, { stamp }).then((ok) => {
      outcome = ok;
    });

    await vi.advanceTimersByTimeAsync(SESSION_SELF_EDIT_REFRESH_TIMEOUT_MS - 1);
    expect(outcome).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toBe(false);
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(stalled).toHaveBeenCalledTimes(1);
    expect(stamp.value).toBeNull();
  });

  it('starts no retry after the deadline when a slow attempt fails just before it', async () => {
    const slowFail = vi.fn(async () => {
      await sleep(SESSION_SELF_EDIT_REFRESH_TIMEOUT_MS - 100);
      return null;
    });
    const result = refreshSessionPlayerNow(() => slowFail, { stamp: sharedStamp() });
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(await result).toBe(false);
    expect(slowFail).toHaveBeenCalledTimes(1);
  });

  it('a slow refresh inside the deadline still succeeds', async () => {
    const slow = vi.fn(async () => {
      await sleep(SESSION_SELF_EDIT_REFRESH_TIMEOUT_MS - 1_000);
      return SESSION;
    });
    const stamp = sharedStamp();
    const result = refreshSessionPlayerNow(() => slow, { stamp });
    await vi.advanceTimersByTimeAsync(SESSION_SELF_EDIT_REFRESH_TIMEOUT_MS - 1_000);
    expect(await result).toBe(true);
    expect(stamp.value).toBe(START);
  });

  it('a self-edit refresh postpones the keep-fresh refresh (shared stamp)', async () => {
    const stamp = sharedStamp();
    const refresh = vi.fn(async () => true);
    const loop = startSessionKeepFresh({ refresh, stamp });
    await vi.advanceTimersByTimeAsync(3 * MINUTE);
    expect(refresh).toHaveBeenCalledTimes(1);

    await refreshSessionPlayerNow(() => vi.fn(async () => SESSION), { stamp });
    await vi.advanceTimersByTimeAsync(2 * MINUTE); // past the loop's original due time
    loop.check();
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2 * MINUTE);
    expect(refresh).toHaveBeenCalledTimes(2);
    loop.stop();
  });
});
