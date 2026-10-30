/**
 * Same-origin redirect targets for the sign-in flow (issue #30). A `callbackUrl` from the query string is only ever a path on
 * this site: anything a browser could read as another host (`//host`, `/\host`, a tab or newline that the URL parser strips,
 * a scheme) falls back to `fallback`. The result is the normalised path, query and hash of the parsed URL, never the raw input.
 */
const PLACEHOLDER_ORIGIN = 'https://callback.invalid';

export function sanitizeCallbackUrl(raw: string | null | undefined, fallback = '/'): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//')) return fallback;
  // Backslashes become slashes in a browser's URL parser, and control characters and whitespace are stripped from it: both
  // can turn a path into `//host`. None of them belongs in a path we would send someone to.
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
