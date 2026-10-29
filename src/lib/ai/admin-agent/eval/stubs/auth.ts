/**
 * `@/auth` for the eval runner (`scripts/tsconfig.admin-agent-eval.json` maps the alias here). The real module starts
 * NextAuth with the Discord provider and needs its secrets.
 *
 * Plan stage: the fixture world answers every read and no guard runs, so nothing here ever signs anyone in. If a guard is
 * reached by mistake it finds nobody and refuses (fail closed), instead of reaching a real session.
 *
 * Local-stack stages: the harness installs a synthetic session for the case's actor (`installEvalSession`) and a player loader
 * (`installSessionPlayerLoader`) that reads the player from the LOCAL `players` table. `auth()` then answers that session, which
 * is what the route entry (`authAndRecord`) records and what the verified-session override carries into the dispatched routes,
 * and `loadSessionPlayer` is what every `require*` guard calls to re-read the player live. No cookie and no NextAuth is involved;
 * the guards themselves are the real ones.
 */
import type { Session } from 'next-auth';
import type { AuthProvider, SessionPlayer } from '@/types/auth';

type PlayerLoader = (provider: AuthProvider, identityId: string) => Promise<SessionPlayer | null>;

let current: Session | null = null;
let loader: PlayerLoader | null = null;

/** Installs (or with `null` clears) the session `auth()` answers. */
export function installEvalSession(session: Session | null): void {
  current = session;
}

/** Installs (or with `null` clears) the live player reader behind `loadSessionPlayer`. */
export function installSessionPlayerLoader(next: PlayerLoader | null): void {
  loader = next;
}

export async function auth(): Promise<Session | null> {
  return current;
}

export async function loadSessionPlayer(provider: AuthProvider, identityId: string): Promise<SessionPlayer | null> {
  return loader === null ? null : loader(provider, identityId);
}
