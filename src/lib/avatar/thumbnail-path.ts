/**
 * Avatar thumbnail naming (DATA-PLAN fix 8, design decision D37).
 *
 * Every avatar original in the `avatars` bucket gets a 256 px WebP thumbnail
 * stored next to it at `<original path>.thumb.webp`. The mapping is
 * deterministic in both directions, so no schema change is needed:
 *
 *   gallery/<playerId>/<uuid>.png  →  gallery/<playerId>/<uuid>.png.thumb.webp
 *   <playerId>.<sha256-16>.jpg     →  <playerId>.<sha256-16>.jpg.thumb.webp
 *
 * `players.avatar_url` points at the thumbnail. `ai_avatar_gallery.image_url`
 * keeps pointing at the original, and the gallery grid derives the thumbnail
 * URL from it.
 *
 * Security: a stored URL becomes a Storage object path only through
 * `avatarStoragePathFromUrl`, which checks the URL's origin against the
 * project's and rejects any path that could escape the bucket. The service-role
 * storage client puts the path into the request URL unencoded, and fetch
 * resolves `../`, so a decoded `..%2F` would otherwise reach other buckets.
 * Only paths on the `isAvatarOriginalPath` whitelist are ever thumbnailed.
 *
 * Client-safe: no Node, sharp or Supabase imports (`NEXT_PUBLIC_*` variables are
 * inlined at build time). The server-side writer is `src/lib/avatar/thumbnail.ts`.
 */

export const AVATAR_BUCKET = 'avatars';
export const AVATAR_THUMB_SUFFIX = '.thumb.webp';
/** Path segment that precedes the object path in a public `avatars` URL. */
export const AVATAR_PUBLIC_PATH_MARKER = `/storage/v1/object/public/${AVATAR_BUCKET}/`;

/**
 * The only object names this module accepts as thumbnailable originals:
 * a gallery item `gallery/<playerId>/<uuid>.<ext>`, or a player's own avatar
 * `<playerId>.<ext>` (legacy stable name) / `<playerId>.<sha256-16>.<ext>`.
 * Lowercase only, exactly as the upload routes write them.
 */
const AVATAR_ORIGINAL_PATH_RE =
  /^(gallery\/[0-9a-f-]{36}\/[0-9a-f-]{36}|[0-9a-f-]{36}(\.[0-9a-f]{16})?)\.(png|jpe?g|webp)$/;

/** ASCII control characters (C0 and DEL). */
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;

/** Normalise an http(s) URL or origin to its origin, or null when it is not one. */
function toHttpOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * Origin of the project's Supabase URL (`NEXT_PUBLIC_SUPABASE_URL`), or null
 * when it is unset or not an http(s) URL. Pass it as the `origin` argument of
 * the URL helpers below.
 */
export function supabasePublicOrigin(): string | null {
  return toHttpOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL);
}

/** Public URL prefix of the `avatars` bucket for an origin: `<origin>/storage/v1/object/public/avatars/`. */
export function avatarPublicUrlPrefix(origin: string): string {
  return `${origin}${AVATAR_PUBLIC_PATH_MARKER}`;
}

/** True when a storage path (or URL path) names a thumbnail. */
export function isAvatarThumbPath(path: string): boolean {
  return path.endsWith(AVATAR_THUMB_SUFFIX);
}

/** Thumbnail path for an original storage path. A thumbnail path is returned unchanged. */
export function avatarThumbPath(originalPath: string): string {
  return isAvatarThumbPath(originalPath) ? originalPath : `${originalPath}${AVATAR_THUMB_SUFFIX}`;
}

/** True when `path` is an image original on the whitelist (see `AVATAR_ORIGINAL_PATH_RE`). */
export function isAvatarOriginalPath(path: string): boolean {
  return AVATAR_ORIGINAL_PATH_RE.test(path);
}

/** Original storage path for a thumbnail path, or null unless it is the thumbnail of a whitelisted original. */
export function avatarOriginalPath(thumbPath: string): string | null {
  if (!isAvatarThumbPath(thumbPath)) return null;
  const original = thumbPath.slice(0, -AVATAR_THUMB_SUFFIX.length);
  return isAvatarOriginalPath(original) ? original : null;
}

/**
 * True for a decoded object path that stays inside the bucket: relative,
 * no empty, `.` or `..` segments, and no `\`, `?`, `#`, `%` (double encoding)
 * or control characters.
 */
function isContainedObjectPath(path: string): boolean {
  if (!path || path.startsWith('/')) return false;
  if (/[\\?#%]/.test(path) || CONTROL_CHAR_RE.test(path)) return false;
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/**
 * Object path inside the `avatars` bucket for a public Storage URL of the
 * project at `origin`, or null for anything else: another origin (Showdown
 * sprites, Discord CDN, a foreign URL that merely contains the bucket path),
 * another bucket, a path that could escape the bucket, or malformed input.
 * A null or invalid `origin` always yields null (fail closed).
 */
export function avatarStoragePathFromUrl(url: string, origin: string | null | undefined): string | null {
  const expectedOrigin = toHttpOrigin(origin);
  if (!expectedOrigin) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.origin !== expectedOrigin || parsed.username || parsed.password) return null;

  const { pathname } = parsed;
  if (!pathname.startsWith(AVATAR_PUBLIC_PATH_MARKER)) return null;

  let path: string;
  try {
    path = decodeURIComponent(pathname.slice(AVATAR_PUBLIC_PATH_MARKER.length));
  } catch {
    return null;
  }
  return isContainedObjectPath(path) ? path : null;
}

/** True when `url` is a public `avatars` URL of the project at `origin` that names a thumbnail of a whitelisted original. */
export function isAvatarThumbUrl(url: string, origin: string | null | undefined): boolean {
  const path = avatarStoragePathFromUrl(url, origin);
  return path !== null && avatarOriginalPath(path) !== null;
}

/**
 * Thumbnail URL for a public `avatars` URL of the project at `origin`. A
 * thumbnail URL is returned in canonical form (no query or fragment). Returns
 * null for URLs outside the bucket or objects off the whitelist, so callers
 * fall back to the URL they have.
 */
export function avatarThumbUrl(url: string, origin: string | null | undefined): string | null {
  const expectedOrigin = toHttpOrigin(origin);
  const path = expectedOrigin ? avatarStoragePathFromUrl(url, expectedOrigin) : null;
  if (!expectedOrigin || !path) return null;

  const original = isAvatarThumbPath(path) ? avatarOriginalPath(path) : path;
  if (!original || !isAvatarOriginalPath(original)) return null;

  // Whitelisted paths are plain ASCII ([0-9a-z./-]), so they need no encoding.
  return `${avatarPublicUrlPrefix(expectedOrigin)}${avatarThumbPath(original)}`;
}

/**
 * The original's URL for a thumbnail URL; any other URL is returned unchanged.
 * String-based on purpose: the result must equal the `image_url` stored for the
 * gallery item byte for byte. It only builds a value to compare against stored
 * URLs; it never produces a Storage object path.
 */
export function avatarOriginalUrl(url: string): string {
  const cut = url.search(/[?#]/);
  const base = cut < 0 ? url : url.slice(0, cut);
  if (!isAvatarThumbPath(base)) return url;
  const original = base.slice(0, -AVATAR_THUMB_SUFFIX.length);
  return /\.(png|jpe?g|webp)$/i.test(original) ? original : url;
}
