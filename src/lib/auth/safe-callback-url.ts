/**
 * Same-origin redirect targets for the sign-in flow (issue #30). A `callbackUrl` from the query string is only ever a path on
 * this site: anything a browser could read as another host (`//host`, `/\host`, a tab or newline that the URL parser strips,
 * a scheme) falls back to `fallback`. The result is the normalised path, query and hash of the parsed URL, never the raw input.
 */
const PLACEHOLDER_ORIGIN = 'https://callback.invalid';

export function sanitizeCallbackUrl(raw: string | null | undefined, fallback = '/'): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//')) return fallback;
  // A browser's URL parser turns backslashes into slashes and strips tabs, newlines and leading or trailing control
  // characters and spaces: any of them can change how the URL parses (`//host`). None belongs in a path we send someone to.
  if (raw.includes('\\') || /[\u0000-\u001f\u007f\s]/.test(raw)) return fallback;
  let parsed: URL;
  try {
    parsed = new URL(raw, PLACEHOLDER_ORIGIN);
  } catch {
    return fallback;
  }
  if (parsed.origin !== PLACEHOLDER_ORIGIN) return fallback;
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

const SIGN_IN_PATH = '/auth/signin';

/**
 * The sign-in page for a visitor who wanted `returnTo` (issue #56). The return path goes through
 * {@link sanitizeCallbackUrl}, so a hostile or malformed value is dropped rather than encoded. No `callbackUrl` is added
 * when there is nothing worth returning to: no path, the home page (the default landing), or any `/auth/*` page (a
 * sign-in page that returned to itself, or to sign-up, would trap the visitor).
 */
export function signInPath(returnTo?: string | null): string {
  const safe = sanitizeCallbackUrl(returnTo, '/');
  if (safe === '/' || safe === '/auth' || safe.startsWith('/auth/') || safe.startsWith('/auth?')) return SIGN_IN_PATH;
  return `${SIGN_IN_PATH}?callbackUrl=${encodeURIComponent(safe)}`;
}
