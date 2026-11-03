import { NextResponse, type NextRequest } from 'next/server';
import { isUnknownWikiOverlayName } from '@/lib/broadcast/wiki-overlay-lookup';
import { REQUEST_PATH_HEADER, requestPathOf } from '@/lib/auth/request-path';
import { signInPath } from '@/lib/auth/safe-callback-url';
import { hasSessionCookie, isSignInGatedPath } from '@/lib/auth/sign-in-gate';
import { buildNoncePolicy, cspEnforced, newNonce } from '@/lib/security/csp-policy.mjs';

/**
 * The single proxy (Next allows one `proxy.ts` per app). It only reads the request URL and writes headers, so it never
 * reads the session: the root layout's "never read the session here" rule still holds.
 *
 *  - `x-poketools-path`: the requested path and query, for `redirectToSignIn` (issue #56).
 *  - `x-nonce` and a per-request nonce policy (issue #37). Next.js reads the nonce from the request's
 *    `Content-Security-Policy` header and stamps it on its own scripts; the root layout reads `x-nonce` for the two
 *    inline scripts it writes itself. The policy goes out as `Content-Security-Policy-Report-Only` while the enforced
 *    static policy of `next.config.mjs` stays in force, or as the enforced `Content-Security-Policy` when `CSP_ENFORCE`
 *    is set (docs/security-patterns.md).
 *  - A signed-out request (no session cookie at all) for a page behind a sign-in guard gets the 307 to sign-in here,
 *    because the guard's own redirect comes after the root `loading.tsx` has committed a 200 (`sign-in-gate.ts`).
 *  - An unknown name under `/broadcast/wiki/{moves,abilities,items,tera}/` gets an empty 404 here.
 */
export function proxy(request: NextRequest) {
  if (
    (request.method === 'GET' || request.method === 'HEAD') &&
    isUnknownWikiOverlayName(request.nextUrl.pathname)
  ) {
    // The root loading.tsx makes every page stream with 200 before `notFound()` runs, so the status is decided here.
    // The body stays empty: an overlay sits on a transparent OBS browser source.
    return new NextResponse(null, {
      status: 404,
      headers: { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex', 'cache-control': 'no-store' },
    });
  }

  if (
    (request.method === 'GET' || request.method === 'HEAD') &&
    isSignInGatedPath(request.nextUrl.pathname) &&
    !hasSessionCookie(request.cookies.getAll().map((cookie) => cookie.name))
  ) {
    return NextResponse.redirect(new URL(signInPath(requestPathOf(request.nextUrl)), request.url), 307);
  }

  const nonce = newNonce();
  const enforce = cspEnforced();
  const policy = buildNoncePolicy({ nonce, dev: process.env.NODE_ENV !== 'production', enforce });

  // `set` and `delete` replace whatever the client sent, so a guard or the layout only ever sees values made here.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_PATH_HEADER, requestPathOf(request.nextUrl));
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', policy);
  requestHeaders.delete('content-security-policy-report-only');

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(enforce ? 'content-security-policy' : 'content-security-policy-report-only', policy);
  return response;
}

// Pages only. The API answers with its own headers, `_next/static` and `_next/image` are immutable assets, and the
// `public/` folders and the service worker files are served as they are.
export const config = {
  matcher: [
    '/((?!api(?:/|$)|_next/static|_next/image|favicon\\.ico|manifest\\.webmanifest|avatar/|basis/|characters/|fonts/|models/|pwa/|textures/|offline\\.html|sw\\.js|sw-routing\\.js).*)',
  ],
};
