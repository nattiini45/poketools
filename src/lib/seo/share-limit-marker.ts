/**
 * How the proxy tells the share page that it already charged the request's `team-shared` allowance.
 *
 * The proxy charges once per original `/teams/shared/<token>` request, because it answers the missing-link 404 before
 * the page runs. The page must not charge the same request a second time, so the proxy hands its verdict down in a
 * request header. The proxy deletes whatever the client sent under this name and sets it only after charging, so the
 * page sees a value only when the proxy wrote it (the same trust as `x-nonce`, `src/proxy.ts`). Any value the page
 * cannot read means "not charged": the page then charges itself, so a malformed header can only cost a request one
 * extra hit, never skip the limit.
 */
export const SHARE_LIMIT_HEADER = 'x-poketools-share-limit';

export type ShareLimitMark = { allowed: true } | { allowed: false; retryAfterSeconds: number };

const DENIED = /^denied:([1-9]\d{0,4})$/;

export function formatShareLimitMark(mark: ShareLimitMark): string {
  return mark.allowed ? 'allowed' : `denied:${Math.max(1, Math.ceil(mark.retryAfterSeconds))}`;
}

export function parseShareLimitMark(value: string | null | undefined): ShareLimitMark | null {
  if (value === 'allowed') return { allowed: true };
  const denied = value ? DENIED.exec(value) : null;
  return denied ? { allowed: false, retryAfterSeconds: Number(denied[1]) } : null;
}
