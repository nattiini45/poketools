/**
 * Page prefixes whose layout or page sends a signed-out visitor to sign-in (the `(player)` layout, the admin layout,
 * the creator studio gate, the trainer creator). The proxy redirects a request for one of them that carries no
 * session cookie at all before anything streams: the root `loading.tsx` commits a 200 before a guard's `redirect()`
 * runs, so the guard alone answers a signed-out `curl` with 200 and a client-side redirect.
 *
 * Only the cookie's absence decides here. A request with any session cookie, valid or not, reaches the guard, which
 * stays the authority; the proxy never reads the session.
 */
const GATED_PREFIXES = ['/dashboard', '/teambuilder', '/admin', '/creator/studio', '/draft-room/trainer-creator'];

// Auth.js names (and the pre-v5 names) of the session JWT cookie, chunked or not, with or without the secure prefix.
const SESSION_COOKIE = /^(?:__Secure-)?(?:authjs|next-auth)\.session-token(?:\.\d+)?$/;

export function isSignInGatedPath(pathname: string): boolean {
  return GATED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function hasSessionCookie(cookieNames: Iterable<string>): boolean {
  for (const name of cookieNames) {
    if (SESSION_COOKIE.test(name)) return true;
  }
  return false;
}
