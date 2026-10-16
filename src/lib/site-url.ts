/**
 * The deployment's public origin, used as the absolute base for canonical and
 * Open Graph URLs (`metadataBase` in src/app/layout.tsx).
 *
 * Order:
 *   1. NEXT_PUBLIC_SITE_URL           — set it to the production origin
 *   2. NEXTAUTH_URL
 *   3. VERCEL_PROJECT_PRODUCTION_URL  — a bare host Vercel sets; prefixed with https://
 *   4. http://localhost:3000
 *
 * An empty or malformed value falls through rather than throwing, because a
 * throwing `new URL` would fail every page render. In production an `http:`
 * value is accepted only for a loopback host (localhost, 127.0.0.1, [::1]);
 * any other `http:` value falls through with a one-time warning, so a
 * deployment never publishes http canonical or Open Graph URLs.
 */

export const FALLBACK_SITE_URL = 'http://localhost:3000';

type SiteUrlEnv = Readonly<Record<string, string | undefined>>;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const warnedNonHttps = new Set<string>();

function parseHttpUrl(value: string, name: string): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol === 'https:') return url;
  if (url.protocol !== 'http:') return null;
  if (process.env.NODE_ENV !== 'production' || LOOPBACK_HOSTS.has(url.hostname)) return url;
  if (!warnedNonHttps.has(name)) {
    warnedNonHttps.add(name);
    console.warn(`[site-url] ignoring non-https ${name} in production`);
  }
  return null;
}

/** A bare host (`app.example.com`); a value that already carries a protocol is used as is. */
function vercelHostUrl(host: string): URL | null {
  return parseHttpUrl(/^[a-z][a-z0-9+.-]*:\/\//i.test(host) ? host : `https://${host}`, 'VERCEL_PROJECT_PRODUCTION_URL');
}

export function siteUrl(env: SiteUrlEnv = process.env): URL {
  for (const name of ['NEXT_PUBLIC_SITE_URL', 'NEXTAUTH_URL'] as const) {
    const trimmed = env[name]?.trim();
    const url = trimmed ? parseHttpUrl(trimmed, name) : null;
    if (url) return url;
  }
  const vercelHost = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const vercelUrl = vercelHost ? vercelHostUrl(vercelHost) : null;
  return vercelUrl ?? new URL(FALLBACK_SITE_URL);
}
