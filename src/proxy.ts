import { NextResponse, type NextRequest } from 'next/server';
import { isUnknownWikiOverlayName } from '@/lib/broadcast/wiki-overlay-lookup';
import { REQUEST_PATH_HEADER, requestPathOf } from '@/lib/auth/request-path';
import { signInPath } from '@/lib/auth/safe-callback-url';
import { hasSessionCookie, isSignInGatedPath } from '@/lib/auth/sign-in-gate';
import { buildNoncePolicy, buildStaticPolicy, cspEnforced, newNonce } from '@/lib/security/csp-policy.mjs';

/**
 * The single proxy (Next allows one `proxy.ts` per app). It only reads the request URL and writes headers, so it never
 * reads the session: the root layout's "never read the session here" rule still holds.
 *
 *  - `x-poketools-path`: the requested path and query, for `redirectToSignIn` (issue #56).
 *  - `x-nonce` and a per-request nonce policy (issue #37). Next.js reads the nonce from the request's
 *    `Content-Security-Policy` header and stamps it on its own scripts; the root layout reads `x-nonce` for the two
 *    inline scripts it writes itself. The nonce policy goes out as `Content-Security-Policy-Report-Only` next to the
 *    enforced static policy (which carries the same nonce in `default-src`, because the render may be handed this
 *    response's header, not the request override), or as the enforced `Content-Security-Policy` when `CSP_ENFORCE` is
 *    set. A page gets no policy from `next.config.mjs` (docs/security-patterns.md).
 *  - A signed-out request (no session cookie at all) for a page behind a sign-in guard gets the 307 to sign-in here,
 *    because the guard's own redirect comes after the root `loading.tsx` has committed a 200 (`sign-in-gate.ts`).
 *  - An unknown name under `/broadcast/wiki/{moves,abilities,items,tera}/` gets an empty 404 here.
 */
export function proxy(request: NextRequest) {
  const dev = process.env.NODE_ENV !== 'production';

  if (
    (request.method === 'GET' || request.method === 'HEAD') &&
    isUnknownWikiOverlayName(request.nextUrl.pathname)
  ) {
    // The root loading.tsx makes every page stream with 200 before `notFound()` runs, so the status is decided here.
    // The body stays empty: an overlay sits on a transparent OBS browser source.
    return new NextResponse(null, {
      status: 404,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'x-robots-tag': 'noindex',
        'cache-control': 'no-store',
        'content-security-policy': buildStaticPolicy({ dev }),
      },
    });
  }

  if (
    (request.method === 'GET' || request.method === 'HEAD') &&
    isSignInGatedPath(request.nextUrl.pathname) &&
    !hasSessionCookie(request.cookies.getAll().map((cookie) => cookie.name))
  ) {
    const redirect = NextResponse.redirect(new URL(signInPath(requestPathOf(request.nextUrl)), request.url), 307);
    redirect.headers.set('content-security-policy', buildStaticPolicy({ dev }));
    return redirect;
  }

  const nonce = newNonce();
  const enforce = cspEnforced();
  const policy = buildNoncePolicy({ nonce, dev, enforce });

  // `set` and `delete` replace whatever the client sent, so a guard or the layout only ever sees values made here.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_PATH_HEADER, requestPathOf(request.nextUrl));
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', policy);
  requestHeaders.delete('content-security-policy-report-only');

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  if (enforce) {
    response.headers.set('content-security-policy', policy);
  } else {
    // The enforced header carries the nonce too (see `buildStaticPolicy`): the platform may hand the render this
    // response header, and Next.js prefers it to the report-only one.
    response.headers.set('content-security-policy', buildStaticPolicy({ nonce, dev }));
    response.headers.set('content-security-policy-report-only', policy);
  }
  return response;
}

// Pages only. The API answers with its own headers, `_next/static` and `_next/image` are immutable assets, and the
// `public/` folders and the service worker files are served as they are.
export const config = {
  matcher: [
    '/((?!api(?:/|$)|_next/static|_next/image|favicon\\.ico|manifest\\.webmanifest|avatar/|basis/|characters/|fonts/|models/|pwa/|textures/|offline\\.html|sw\\.js|sw-routing\\.js).*)',
  ],
};
