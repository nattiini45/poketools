import { randomUUID } from 'node:crypto';
import { supabasePublicOrigin } from '@/lib/avatar/thumbnail-path';

/**
 * Naming of the match social cards in the `social-images` bucket.
 *
 * Every upload gets a NEW immutable object, `matches/<matchId>/<uuid>.png`,
 * served with a one-year cache, and `matches.social_image_url` moves to it.
 * An object is never overwritten in place (root AGENTS.md storage rule): a
 * re-upload under one fixed name kept the same URL, so the CDN, browsers and
 * Discord/social link previews served the old card for up to the cache age.
 * Uploads before this change used the fixed name `matches/<matchId>.png`;
 * that legacy name is still recognised so it can be removed.
 *
 * A stored URL becomes an object path only through `socialImagePathFromUrl`,
 * which checks the project's origin, the bucket, and a strict whitelist of
 * the two names above for THIS match (see the Never Do list in AGENTS.md: the
 * service-role storage client puts the path into the request unencoded).
 */

export const SOCIAL_IMAGE_BUCKET = 'social-images';

/** Largest card the upload route accepts (5 MB); the social providers' fetch uses the same cap. */
export const SOCIAL_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** One year: the object under a name never changes. */
export const SOCIAL_IMAGE_CACHE_CONTROL = '31536000';

const PUBLIC_PATH_MARKER = `/storage/v1/object/public/${SOCIAL_IMAGE_BUCKET}/`;
const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const MATCH_ID_RE = new RegExp(`^${UUID_PATTERN}$`);

/** A new immutable object name for a match's social card. `matchId` is the row's (lowercase) id. */
export function socialImagePath(matchId: string, objectId: string = randomUUID()): string {
  return `matches/${matchId}/${objectId}.png`;
}

/**
 * The object path in `social-images` that a stored `social_image_url` of
 * match `matchId` names, or null for anything else: another origin or
 * bucket, another match's object, a name this route never writes, or
 * malformed input. A null `origin` yields null (fail closed).
 */
export function socialImagePathFromUrl(
  url: string,
  matchId: string,
  origin: string | null = supabasePublicOrigin(),
): string | null {
  if (!origin || !MATCH_ID_RE.test(matchId)) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.origin !== origin || parsed.username || parsed.password) return null;
  if (!parsed.pathname.startsWith(PUBLIC_PATH_MARKER)) return null;

  let path: string;
  try {
    path = decodeURIComponent(parsed.pathname.slice(PUBLIC_PATH_MARKER.length));
  } catch {
    return null;
  }

  // Whitelist: the legacy fixed name, or an immutable name, of THIS match.
  const allowed = new RegExp(`^matches/${matchId}(\\.png|/${UUID_PATTERN}\\.png)$`);
  return allowed.test(path) ? path : null;
}
