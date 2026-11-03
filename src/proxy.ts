import { NextResponse, type NextRequest } from 'next/server';
import { isUnknownWikiOverlayName } from '@/lib/broadcast/wiki-overlay-lookup';
import { REQUEST_PATH_HEADER, requestPathOf } from '@/lib/auth/request-path';
import { signInPath } from '@/lib/auth/safe-callback-url';
import { hasSessionCookie, isSignInGatedPath } from '@/lib/auth/sign-in-gate';
import { pageGate, type PageGateResult } from '@/lib/seo/page-gate';
import { formatShareLimitMark, SHARE_LIMIT_HEADER } from '@/lib/seo/share-limit-marker';
import { buildNoncePolicy, buildStaticPolicy, cspEnforced, isVercelPreview, newNonce } from '@/lib/security/csp-policy.mjs';

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
 *  - A page whose subject is missing (a malformed, disabled or unknown team link, an unknown league, tournament, species
 *    or wiki entry) is rewritten to the not-found page with a real 404 (`pageGate`, `src/lib/seo/page-gate.ts`).
 *  - A shared team page request spends the common `team-shared` allowance here, once, and the page is told through
 *    `x-poketools-share-limit` (`src/lib/seo/share-limit-marker.ts`).
 */
export async function proxy(request: NextRequest) {
  const dev = process.env.NODE_ENV !== 'production';
  const previewToolbar = isVercelPreview();

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
        'content-security-policy': buildStaticPolicy({ dev, previewToolbar }),
      },
    });
  }

  if (
    (request.method === 'GET' || request.method === 'HEAD') &&
    isSignInGatedPath(request.nextUrl.pathname) &&
    !hasSessionCookie(request.cookies.getAll().map((cookie) => cookie.name))
  ) {
    const redirect = NextResponse.redirect(new URL(signInPath(requestPathOf(request.nextUrl)), request.url), 307);
    redirect.headers.set('content-security-policy', buildStaticPolicy({ dev, previewToolbar }));
    return redirect;
  }

  const nonce = newNonce();
  const enforce = cspEnforced();
  const policy = buildNoncePolicy({ nonce, dev, enforce, previewToolbar });

  // `set` and `delete` replace whatever the client sent, so a guard or the layout only ever sees values made here.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_PATH_HEADER, requestPathOf(request.nextUrl));
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', policy);
  requestHeaders.delete('content-security-policy-report-only');

  // The share page only counts a request the proxy did not (`share-limit-marker.ts`), so the header is always the
  // proxy's own verdict: the delete above the gate drops a client-supplied one, and only a charge sets it again.
  requestHeaders.delete(SHARE_LIMIT_HEADER);
  const gate: PageGateResult =
    request.method === 'GET' || request.method === 'HEAD'
      ? await pageGate(request.nextUrl.pathname, request.headers)
      : { status: null, shareLimit: null };
  if (gate.shareLimit) requestHeaders.set(SHARE_LIMIT_HEADER, formatShareLimitMark(gate.shareLimit));

  // The not-found page renders for the rewritten request, so it gets the same nonce and policy as any page.
  const pageMissing = gate.status === 'not_found';
  const response = pageMissing
    ? NextResponse.rewrite(new URL('/_not-found', request.url), { request: { headers: requestHeaders }, status: 404 })
    : NextResponse.next({ request: { headers: requestHeaders } });
  if (enforce) {
    response.headers.set('content-security-policy', policy);
  } else {
    // The enforced header carries the nonce too (see `buildStaticPolicy`): the platform may hand the render this
    // response header, and Next.js prefers it to the report-only one.
    response.headers.set('content-security-policy', buildStaticPolicy({ nonce, dev, previewToolbar }));
    response.headers.set('content-security-policy-report-only', policy);
  }
  return response;
}

// Pages only. The API answers with its own headers, `_next/static` and `_next/image` are immutable assets, and the
// `public/` folders and the service worker files are served as they are. Folders are skipped at a segment boundary and
// files exactly, so a lookalike such as `/favicon.ico/x` is still a page here and gets a policy, in step with the
// `next.config.mjs` sources of `PROXY_SKIPPED_SOURCES`.
export const config = {
  matcher: [
    '/((?!(?:api|_next/static|avatar|basis|characters|fonts|models|pwa|textures)(?:/|$)|(?:_next/image|favicon\\.ico|manifest\\.webmanifest|offline\\.html|sw\\.js|sw-routing\\.js)$).*)',
  ],
};
