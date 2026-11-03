import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getLiveSessionPlayer } from '@/lib/auth/helpers';
import { REQUEST_PATH_HEADER } from '@/lib/auth/request-path';
import { signInPath } from '@/lib/auth/safe-callback-url';
import type { SessionPlayer } from '@/types/auth';

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

/**
 * Gate for a signed-in VIEW: the live player (`getLiveSessionPlayer`, one narrow read shared by the layout, the page
 * and the guards of a render), or the sign-in redirect when there is none. The token copy `getSession()` returns can be
 * up to 5 minutes stale, so after a ban, "sign out everywhere" or a password reset it would still admit the view. A
 * failed live read throws (fail closed). The sign-in page never reads the session, so this cannot loop.
 */
export async function requireLivePlayerOrSignIn(returnTo?: string): Promise<SessionPlayer> {
  const player = await getLiveSessionPlayer();
  if (!player) return redirectToSignIn(returnTo);
  return player;
}
