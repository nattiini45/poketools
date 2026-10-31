import 'server-only';
/**
 * Verified-session override: lets the Admin Assistant's dispatch layer run an existing route handler as the admin who
 * is signed in on the CURRENT request, without a cookie on the synthetic `NextRequest` it builds.
 *
 * This is an impersonation primitive: whoever can enter the store acts as that identity. It is therefore protected by
 * code, not by convention:
 *
 * - The store is module-private and never exported. The only read path is `getVerifiedSession()` (what `getSession()`
 *   in `helpers.ts` calls); the only write path is `runAsVerifiedSession()`.
 * - `runAsVerifiedSession()` accepts only a `Session` object that `recordAuthSession()` saw, which is what
 *   `authAndRecord()` does with the result of `auth()`. A session built by hand, parsed from JSON, read from the
 *   database or copied with a spread is a different object and is refused.
 * - `runAsVerifiedSession()` refuses a session whose `expires` has passed (or cannot be read), before every run.
 * - An allow-list test (`__tests__/session-override-static.test.ts`) keeps `runAsVerifiedSession` importable only from
 *   `src/lib/ai/admin-agent/dispatch/` and keeps every other file from declaring its own session store.
 *
 * What it is not: it does not replace the guards. The override carries the whole `Session` (provider, user id AND
 * email, because `isSuperadmin` matches a credentials session on the email), and every `require*` guard in
 * `helpers.ts` still re-reads the player, roles, ban state and resource-admin rows live. A revocation mid-run is
 * honoured. Inside a real Next request the ambient cookie stays readable as well, so "no override and no cookie" is
 * not the safety property; the WeakSet and the allow-list are.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Session } from 'next-auth';
import { auth } from '@/auth';

const store = new AsyncLocalStorage<Session>();

/** Sessions that `auth()` returned on a real request (see `recordAuthSession`). Weak, so a session is not kept alive. */
const authSessions = new WeakSet<Session>();

/**
 * The session an enclosing `runAsVerifiedSession()` runs as, or `undefined` outside one. The only export
 * `helpers.ts` reads.
 */
export function getVerifiedSession(): Session | undefined {
  return store.getStore();
}

/**
 * Marks `session` as one that `auth()` returned. Called by `authAndRecord()` (the wrapped `auth()` the chat and
 * approve routes use) and by nothing else.
 */
export function recordAuthSession(session: Session): void {
  authSessions.add(session);
}

/**
 * `auth()` plus `recordAuthSession()`: the session of the current request, recorded so the dispatch layer may run
 * handlers as it. Null when nobody is signed in (nothing to record).
 */
export async function authAndRecord(): Promise<Session | null> {
  const session = await auth();
  if (session) recordAuthSession(session);
  return session;
}

/** True while `expires` (an ISO date string) lies in the future. An unreadable value counts as expired (fail closed). */
function isUnexpired(expires: string | undefined): boolean {
  if (typeof expires !== 'string') return false;
  const at = Date.parse(expires);
  return Number.isFinite(at) && at > Date.now();
}

/**
 * Runs `fn` with `session` as the verified session: every `getSession()` call inside it (the `require*` guards, the
 * live gates) answers `session` instead of reading the cookie. Throws, before `fn` starts, unless `session` is the
 * object `recordAuthSession()` saw and has not expired.
 */
export function runAsVerifiedSession<T>(session: Session, fn: () => Promise<T>): Promise<T> {
  if (!authSessions.has(session)) {
    throw new Error('[session-override] refused: the session was not returned by auth() on this request');
  }
  if (!isUnexpired(session.expires)) {
    throw new Error('[session-override] refused: the session has expired');
  }
  return store.run(session, fn);
}
