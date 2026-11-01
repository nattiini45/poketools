/**
 * The account-level session epoch (`players.sessions_valid_after`).
 *
 * A token records when its sign-in happened (`authAt`, epoch ms). It is dead
 * once the player's epoch moves past that moment: a password reset, a ban or
 * suspension, a guest claim and "sign out everywhere" move it forward, and
 * nothing moves it back, so lifting a suspension does not revive an old token.
 * No module here imports `@/auth`, so the session layer and the guards share
 * one decision.
 */

/** Thrown by a live read when the token predates the player's epoch. The guards turn it into a 401. */
export class SessionRevokedError extends Error {
  constructor() {
    super('Session revoked');
    this.name = 'SessionRevokedError';
  }
}

/**
 * The epoch as epoch ms. PostgREST sends `'-infinity'` for a player that was
 * never revoked and an ISO timestamp otherwise. Anything else throws, so an
 * unreadable epoch fails closed instead of reading as "never revoked".
 */
export function parseSessionsValidAfter(value: unknown): number {
  if (value === '-infinity') return Number.NEGATIVE_INFINITY;
  if (typeof value !== 'string') {
    throw new Error(`[session-epoch] sessions_valid_after is not a string: ${typeof value}`);
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new Error('[session-epoch] sessions_valid_after is not a timestamp');
  }
  return ms;
}

/**
 * True when a token issued at `authAt` is revoked by `sessionsValidAfter`
 * (the raw column value). Equal is valid. A token without a usable `authAt`
 * (minted before the stamp existed) counts as issued at the beginning of time:
 * valid until the first revocation, revoked by any.
 */
export function isSessionRevoked(authAt: unknown, sessionsValidAfter: unknown): boolean {
  const validAfter = parseSessionsValidAfter(sessionsValidAfter);
  if (validAfter === Number.NEGATIVE_INFINITY) return false;
  const issuedAt = typeof authAt === 'number' && Number.isFinite(authAt) ? authAt : Number.NEGATIVE_INFINITY;
  return issuedAt < validAfter;
}
