import { NextResponse, type NextRequest } from 'next/server';
import { REQUEST_PATH_HEADER, requestPathOf } from '@/lib/auth/request-path';

/**
 * The single proxy (Next allows one `proxy.ts` per app). It touches only request headers and does no I/O, so it never
 * reads the session: the root layout's "never read the session here" rule still holds.
 */
export function proxy(request: NextRequest) {
  // `set` replaces any value the client sent, so a guard can only ever see the path this request actually asked for.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_PATH_HEADER, requestPathOf(request.nextUrl));

  return NextResponse.next({ request: { headers: requestHeaders } });
}

// Pages only. The API answers with its own headers, `_next/static` and `_next/image` are immutable assets, and the
// `public/` folders and the service worker files are served as they are.
export const config = {
  matcher: [
    '/((?!api(?:/|$)|_next/static|_next/image|favicon\\.ico|avatar/|basis/|characters/|fonts/|models/|pwa/|textures/|offline\\.html|sw\\.js|sw-routing\\.js).*)',
  ],
};
