'use client';

import { useCallback, useEffect, useEffectEvent, useRef } from 'react';
import type { Session } from 'next-auth';
import {
  SessionProvider as NextAuthSessionProvider,
  useSession,
  type UpdateSession,
} from 'next-auth/react';

/**
 * Session freshness on the client (DATA-PLAN fixes 3 and 3b, design decision D37).
 *
 * The session JWT carries a copy of the signed-in player that the jwt callback
 * in src/auth.ts re-reads only when it is SESSION_PLAYER_TTL_MS (5 min) old,
 * or at once on trigger 'update'. Server-side auth() never rewrites the
 * cookie, so a token past its TTL makes EVERY server render and API call
 * re-read the player until something rewrites the cookie. Only requests to
 * /api/auth/session do.
 *
 * So a signed-in, visible tab forces a refresh every
 * SESSION_KEEP_FRESH_INTERVAL_MS (4 min, one minute inside the TTL): a POST
 * to /api/auth/session (trigger 'update'), one narrow player read, and a
 * rewritten cookie. The token therefore never passes its TTL while a tab is
 * in use, and server-side auth() reads no database between refreshes. The
 * old 5-minute GET poll sat exactly on the TTL: a poll that landed a few ms
 * early re-read nothing and left the token due, and so re-read on every
 * request, for the next 5 minutes.
 *
 * - Tabs share one timestamp (localStorage, or memory when storage is
 *   blocked), so several open tabs still cost one read per interval: the
 *   first tab to fall due claims it.
 * - A hidden or offline tab does not refresh. On becoming visible (or coming
 *   back online) it refreshes at once if the interval has passed.
 * - A tab that opens with no recent refresh on record refreshes at once, so
 *   the first interval is covered too.
 * - Window focus does not refetch (DATA-PLAN fix 3), and next-auth's own GET
 *   poll is off: the forced refresh replaces it.
 *
 * Self-edits: a flow that changes the signed-in player's own name, usernames
 * or avatar awaits useRefreshSessionPlayer()() after the write succeeds and
 * before it navigates or calls router.refresh().
 */

/**
 * Mirror of SESSION_PLAYER_TTL_MS in src/auth.ts. That module is
 * server-only, so the value is repeated here;
 * __tests__/session-keep-fresh.test.ts asserts that the two agree.
 */
export const CLIENT_SESSION_PLAYER_TTL_MS = 5 * 60 * 1000;

/** How often a visible, signed-in tab forces a refresh: one minute inside the TTL. */
export const SESSION_KEEP_FRESH_INTERVAL_MS = 4 * 60 * 1000;

/** Wait after a refresh that could not run (hidden, offline) or failed. */
export const SESSION_KEEP_FRESH_RETRY_MS = 30 * 1000;

const REFRESHED_AT_KEY = 'poketools:session-refreshed-at';

/** When this browser last forced a successful refresh (client clock, any tab). */
export interface RefreshStamp {
  read(): number | null;
  write(at: number): void;
}

let memoryStamp: number | null = null;

/**
 * The shared stamp: localStorage so tabs see each other's refreshes, with an
 * in-memory fallback when storage is blocked. It holds a time only, never
 * session data.
 */
export const browserRefreshStamp: RefreshStamp = {
  read() {
    let latest = memoryStamp;
    try {
      const raw = window.localStorage.getItem(REFRESHED_AT_KEY);
      const stored = raw === null ? Number.NaN : Number(raw);
      if (Number.isFinite(stored) && (latest === null || stored > latest)) latest = stored;
    } catch {
      // Storage blocked, or no window: memory only.
    }
    return latest;
  },
  write(at) {
    memoryStamp = at;
    try {
      window.localStorage.setItem(REFRESHED_AT_KEY, String(at));
    } catch {
      // Storage blocked: memory only.
    }
  },
};

/**
 * Forces the jwt callback to re-read the signed-in player now (trigger
 * 'update') and rewrite the session cookie. True when a session came back.
 *
 * It calls `update({})`, never a bare `update()`: next-auth sends an update
 * without data as a GET, which the server treats as a plain session read, so
 * inside the TTL nothing would be re-read. The `{}` is ignored by the jwt
 * callback, which takes the player only from the database. Never throws.
 */
export async function requestSessionRefresh(update: UpdateSession): Promise<boolean> {
  try {
    return (await update({})) != null;
  } catch {
    return false;
  }
}

export interface KeepFreshLoop {
  /** Refresh now if the interval has passed, otherwise re-arm the timer. */
  check(): void;
  stop(): void;
}

export interface KeepFreshOptions {
  /** One forced refresh; resolves true on success (see requestSessionRefresh). */
  refresh: () => Promise<boolean>;
  /** False while the tab is hidden or offline: the loop then waits. */
  canRefresh?: () => boolean;
  stamp?: RefreshStamp;
  now?: () => number;
  intervalMs?: number;
  retryMs?: number;
}

/**
 * The keep-fresh timer, free of React so it can be tested with fake timers.
 * It checks at once on start.
 *
 * - The stamp records when a refresh STARTED, so the interval is measured
 *   conservatively against the server's refreshedAt.
 * - The stamp is written as a claim before the request goes out. Tabs arm
 *   their timers from the same stamp and so fall due together; the first one
 *   claims the interval and the others see the claim and wait.
 * - A refresh that fails leaves its claim, so other tabs keep waiting, and
 *   this tab retries every retryMs, ignoring the stamp, until one succeeds.
 *   (If that tab closes while failing, the others take over when the claim's
 *   interval ends.)
 * - A stamp from the future (a clock change) counts as due.
 */
export function startSessionKeepFresh({
  refresh,
  canRefresh = () => true,
  stamp = browserRefreshStamp,
  now = Date.now,
  intervalMs = SESSION_KEEP_FRESH_INTERVAL_MS,
  retryMs = SESSION_KEEP_FRESH_RETRY_MS,
}: KeepFreshOptions): KeepFreshLoop {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let stopped = false;
  /** This tab's last refresh failed: retry regardless of the (claimed) stamp. */
  let retrying = false;

  function arm(delayMs: number): void {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(check, Math.max(0, delayMs));
  }

  function check(): void {
    if (stopped || inFlight) return;

    if (!retrying) {
      const last = stamp.read();
      const age = last === null ? Number.POSITIVE_INFINITY : now() - last;
      if (age >= 0 && age < intervalMs) {
        // This tab, another tab or a self-edit refreshed (or claimed) recently.
        arm(intervalMs - age);
        return;
      }
    }
    if (!canRefresh()) {
      // No request while hidden or offline. The visibilitychange/online
      // listeners re-check on return; this re-check (a stamp read, no
      // request) still catches a return whose event never arrived, which
      // would otherwise leave the loop without a timer until remount.
      arm(retryMs);
      return;
    }

    inFlight = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    const startedAt = now();
    stamp.write(startedAt);
    refresh()
      .catch(() => false)
      .then((ok) => {
        inFlight = false;
        retrying = !ok;
        if (stopped) return;
        arm(ok ? intervalMs - (now() - startedAt) : retryMs);
      });
  }

  check();

  return {
    check,
    stop() {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

function tabCanRefresh(): boolean {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  return true;
}

/** Runs the keep-fresh loop while a session exists. Renders nothing. */
function SessionKeepFresh(): null {
  const { data: session, update } = useSession();
  const signedIn = session != null;
  const refresh = useEffectEvent(() => requestSessionRefresh(update));

  useEffect(() => {
    if (!signedIn) return;
    const loop = startSessionKeepFresh({
      refresh: () => refresh(),
      canRefresh: tabCanRefresh,
    });
    const onVisible = () => {
      if (document.visibilityState === 'visible') loop.check();
    };
    const onOnline = () => loop.check();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      loop.stop();
    };
  }, [signedIn]);

  return null;
}

/**
 * The longest a self-edit refresh holds its caller. next-auth's update()
 * fetches with no timeout, so a stalled connection would otherwise keep the
 * caller's save button busy and its navigation waiting until the browser
 * gives up. A healthy refresh takes well under a second.
 */
export const SESSION_SELF_EDIT_REFRESH_TIMEOUT_MS = 10 * 1000;

/**
 * One self-edit refresh, retried: next-auth's update() returns nothing while
 * another update() is in flight (for example this tab's keep-fresh refresh,
 * which may have read the row before the write landed), so a failed attempt
 * waits and tries again with the then-current update function.
 *
 * Bounded by timeoutMs: at the deadline it resolves false and starts no
 * further attempt. A stalled request is not cancelled (update() takes no
 * signal); if it lands later it still rewrites the cookie and the stamp.
 */
export async function refreshSessionPlayerNow(
  getUpdate: () => UpdateSession,
  {
    stamp = browserRefreshStamp,
    now = Date.now,
    attempts = 3,
    retryDelayMs = 250,
    timeoutMs = SESSION_SELF_EDIT_REFRESH_TIMEOUT_MS,
  }: {
    stamp?: RefreshStamp;
    now?: () => number;
    attempts?: number;
    retryDelayMs?: number;
    timeoutMs?: number;
  } = {}
): Promise<boolean> {
  let expired = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<boolean>((resolve) => {
    deadline = setTimeout(() => {
      expired = true;
      resolve(false);
    }, timeoutMs);
  });

  async function attemptAll(): Promise<boolean> {
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      if (expired) return false;
      const startedAt = now();
      if (await requestSessionRefresh(getUpdate())) {
        stamp.write(startedAt);
        return true;
      }
    }
    return false;
  }

  try {
    return await Promise.race([attemptAll(), timedOut]);
  } finally {
    clearTimeout(deadline);
  }
}

/**
 * For self-edit flows: returns a function that re-reads the signed-in player
 * into the session now (trigger 'update') and rewrites the cookie, so the
 * NavBar, the dashboard and every server render show the new name, usernames
 * or avatar at once. Await it after the write succeeds and before navigating
 * or calling router.refresh():
 *
 *   const refreshSessionPlayer = useRefreshSessionPlayer();
 *   // ... after a successful save:
 *   await refreshSessionPlayer();
 *   window.location.href = '/dashboard';
 *
 * Resolves false when every attempt failed or the refresh stalled past
 * SESSION_SELF_EDIT_REFRESH_TIMEOUT_MS (the write itself stands; the session
 * then catches up within the TTL). Never throws.
 */
export function useRefreshSessionPlayer(): () => Promise<boolean> {
  const { update } = useSession();
  const latestUpdate = useRef(update);
  useEffect(() => {
    latestUpdate.current = update;
  }, [update]);
  return useCallback(() => refreshSessionPlayerNow(() => latestUpdate.current), []);
}

interface Props {
  children: React.ReactNode;
  /**
   * Optional server session. When passed, the client skips its initial
   * /api/auth/session fetch. The root layout does not pass it: calling auth()
   * there reads request headers, which would opt every route (including the
   * statically prerendered /wiki pages) into dynamic rendering.
   */
  session?: Session | null;
}

export default function SessionProvider({ children, session }: Props) {
  return (
    <NextAuthSessionProvider session={session} refetchOnWindowFocus={false}>
      <SessionKeepFresh />
      {children}
    </NextAuthSessionProvider>
  );
}
