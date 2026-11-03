import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { REQUEST_PATH_HEADER } from '@/lib/auth/request-path';
import { signInPath } from '@/lib/auth/safe-callback-url';

/**
 * The sign-in page URL for the request being rendered (issue #56). The proxy writes the requested path and query into
 * `x-poketools-path` on every page request, overwriting whatever the client sent, so the value is trusted only as far as
 * `signInPath` sanitises it. With no header (a render outside the proxy matcher) the result is the bare sign-in page,
 * never the home page. A page that knows its own path passes it as `returnTo`.
 */
export async function currentSignInPath(returnTo?: string): Promise<string> {
  const path = returnTo ?? (await headers()).get(REQUEST_PATH_HEADER);
  return signInPath(path);
}

/** Sends a signed-out visitor to sign-in with the page they wanted as the return path. Call as `return redirectToSignIn()` so TypeScript narrows. */
export async function redirectToSignIn(returnTo?: string): Promise<never> {
  return redirect(await currentSignInPath(returnTo));
}
