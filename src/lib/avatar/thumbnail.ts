import 'server-only';

import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { OutputInfo } from 'sharp';
import type { supabase } from '@/lib/supabase/client';
import {
  avatarOriginalPath,
  avatarStoragePathFromUrl,
  avatarThumbPath,
  isAvatarOriginalPath,
  isAvatarThumbPath,
  supabasePublicOrigin,
} from './thumbnail-path';

/**
 * Server-side avatar thumbnails (DATA-PLAN fix 8, design decision D37).
 *
 * A 256 px WebP of at most ~30 KB is written next to every avatar original, so
 * the 20-64 px avatar slots and the gallery grid stop downloading the
 * full-size (up to 5 MB) image. Naming lives in `./thumbnail-path.ts`.
 */

/** The `avatars` bucket API (the shape `supabase.storage.from('avatars')` returns). */
export type AvatarBucket = ReturnType<typeof supabase.storage.from>;

export const AVATAR_THUMB_SIZE = 256;
export const AVATAR_THUMB_TARGET_BYTES = 30 * 1024;
export const AVATAR_THUMB_CONTENT_TYPE = 'image/webp';
/**
 * One year, in seconds (Supabase Storage's `cacheControl` format). Only for
 * immutable paths: UUID gallery paths, content-hashed player paths and the
 * thumbnails derived from them.
 */
export const AVATAR_IMMUTABLE_CACHE_CONTROL = '31536000';

/** WebP qualities tried in order until the thumbnail fits the byte target. */
const WEBP_QUALITY_LADDER = [80, 70, 60, 50, 40] as const;
/** Decompression-bomb guard: 25 MP is well above any avatar we accept. */
const MAX_INPUT_PIXELS = 25_000_000;
/** Image extensions a player's own avatar objects can carry. */
const PLAYER_AVATAR_EXTS = ['png', 'jpg', 'webp'] as const;

export type AvatarThumbnailStage = 'path' | 'decode' | 'encode' | 'exists' | 'download' | 'upload';

/** A thumbnail step failed. `stage` keeps the causes distinguishable in logs and reports. */
export class AvatarThumbnailError extends Error {
  readonly stage: AvatarThumbnailStage;

  constructor(stage: AvatarThumbnailStage, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AvatarThumbnailError';
    this.stage = stage;
  }
}

/**
 * Encode a WebP thumbnail that fits inside 256 x 256 (aspect ratio kept, never
 * enlarged, EXIF orientation applied, metadata stripped). Qualities step down
 * until the result is at most 30 KB; if none fits, the smallest is returned.
 */
export async function createAvatarThumbnail(input: Buffer): Promise<Buffer> {
  let resized: { data: Buffer; info: OutputInfo };
  try {
    resized = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize(AVATAR_THUMB_SIZE, AVATAR_THUMB_SIZE, { fit: 'inside', withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch (err) {
    throw new AvatarThumbnailError('decode', 'Avatar image could not be decoded', { cause: err });
  }

  const { width, height, channels } = resized.info;
  let smallest: Buffer | null = null;
  try {
    for (const quality of WEBP_QUALITY_LADDER) {
      const encoded = await sharp(resized.data, { raw: { width, height, channels } })
        .webp({ quality, effort: 4 })
        .toBuffer();
      if (encoded.length <= AVATAR_THUMB_TARGET_BYTES) return encoded;
      if (!smallest || encoded.length < smallest.length) smallest = encoded;
    }
  } catch (err) {
    throw new AvatarThumbnailError('encode', 'Avatar thumbnail could not be encoded', { cause: err });
  }

  // The ladder always runs at least once, so `smallest` is set here.
  return smallest as Buffer;
}

function isAlreadyExistsError(error: { status?: number; statusCode?: string; message?: string }): boolean {
  return error.statusCode === '409' || error.status === 409 || /already exists/i.test(error.message ?? '');
}

/**
 * Upload an encoded thumbnail next to `originalPath` with the immutable cache.
 * An existing object at the thumbnail path counts as success (the name is
 * derived from an immutable original, so it holds the same image).
 */
export async function putAvatarThumbnail(
  bucket: AvatarBucket,
  originalPath: string,
  thumbnail: Buffer,
): Promise<{ path: string; created: boolean; bytes: number }> {
  const path = avatarThumbPath(originalPath);
  const { error } = await bucket.upload(path, thumbnail, {
    contentType: AVATAR_THUMB_CONTENT_TYPE,
    cacheControl: AVATAR_IMMUTABLE_CACHE_CONTROL,
    upsert: false,
  });

  if (error) {
    if (isAlreadyExistsError(error)) return { path, created: false, bytes: 0 };
    throw new AvatarThumbnailError('upload', `Avatar thumbnail upload failed: ${error.message}`, { cause: error });
  }
  return { path, created: true, bytes: thumbnail.length };
}

/** Encode and upload the thumbnail for an original that is already in memory. */
export async function writeAvatarThumbnail(
  bucket: AvatarBucket,
  originalPath: string,
  original: Buffer,
): Promise<{ path: string; created: boolean; bytes: number }> {
  const thumbnail = await createAvatarThumbnail(original);
  return putAvatarThumbnail(bucket, originalPath, thumbnail);
}

/**
 * Gallery generations treat the thumbnail as non-critical: the grid falls back
 * to the original. Failures are logged with their stage and return null.
 */
export async function tryWriteAvatarThumbnail(
  bucket: AvatarBucket,
  originalPath: string,
  original: Buffer,
  logTag: string,
): Promise<string | null> {
  try {
    const { path } = await writeAvatarThumbnail(bucket, originalPath, original);
    return path;
  } catch (err) {
    const stage = err instanceof AvatarThumbnailError ? err.stage : 'unknown';
    console.error(`[${logTag}] Avatar thumbnail failed at ${stage} for ${originalPath}:`, err);
    return null;
  }
}

/**
 * Refuse any original path off the whitelist before it reaches the bucket.
 * The existence check and `ensureAvatarThumbnail` take paths derived from
 * stored URLs, so they re-check here even though their callers already did.
 */
function assertAvatarOriginalPath(originalPath: string): void {
  if (!isAvatarOriginalPath(originalPath)) {
    throw new AvatarThumbnailError('path', 'Not an avatar original path');
  }
}

/** HEAD-only existence check for the thumbnail of `originalPath` (no object bytes are downloaded). */
export async function avatarThumbnailExists(bucket: AvatarBucket, originalPath: string): Promise<boolean> {
  assertAvatarOriginalPath(originalPath);
  try {
    const { data } = await bucket.exists(avatarThumbPath(originalPath));
    return data === true;
  } catch (err) {
    throw new AvatarThumbnailError('exists', 'Avatar thumbnail existence check failed', { cause: err });
  }
}

/**
 * Make sure a stored original has a thumbnail: skip when it exists, otherwise
 * download the original once, encode and upload. Idempotent. Throws a
 * `path`-stage error, touching nothing, for a path off the whitelist.
 */
export async function ensureAvatarThumbnail(
  bucket: AvatarBucket,
  originalPath: string,
): Promise<{ path: string; created: boolean; bytes: number }> {
  if (await avatarThumbnailExists(bucket, originalPath)) {
    return { path: avatarThumbPath(originalPath), created: false, bytes: 0 };
  }

  const { data, error } = await bucket.download(originalPath);
  if (error || !data) {
    throw new AvatarThumbnailError(
      'download',
      `Avatar original download failed: ${error?.message ?? 'empty body'}`,
      { cause: error ?? undefined },
    );
  }

  const original = Buffer.from(await data.arrayBuffer());
  return writeAvatarThumbnail(bucket, originalPath, original);
}

// ─── Player-owned avatar objects ──────────────────────────────────────

/** First 16 hex characters of the SHA-256 of `data`: a content version for immutable names. */
export function avatarContentHash(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex').slice(0, 16);
}

/**
 * Versioned path for a player's uploaded avatar. The content hash makes the
 * name immutable, so a 1-year cache can never serve a stale avatar (the old
 * stable `<playerId>.<ext>` name was overwritten in place).
 */
export function playerAvatarUploadPath(playerId: string, contentHash: string, ext: string): string {
  return `${playerId}.${contentHash}.${ext}`;
}

/** The pre-versioning stable names, plus any thumbnails the backfill derived from them. */
export function legacyPlayerAvatarPaths(playerId: string): string[] {
  return PLAYER_AVATAR_EXTS.flatMap((ext) => {
    const original = `${playerId}.${ext}`;
    return [original, avatarThumbPath(original)];
  });
}

/** True for one of this player's own avatar objects at the bucket root (never a gallery item). */
export function isPlayerAvatarPath(playerId: string, path: string): boolean {
  return !path.includes('/') && path.startsWith(`${playerId}.`);
}

/**
 * Objects to remove once a player's avatar has been replaced or cleared: the
 * legacy stable names and the previous versioned original + thumbnail. Gallery
 * objects are never included (the gallery owns them). `keep` wins.
 *
 * The previous avatar counts only when it is a URL of this project's bucket
 * (`origin`, default `NEXT_PUBLIC_SUPABASE_URL`) naming one of this player's
 * whitelisted originals or its thumbnail; anything else is left alone.
 */
export function stalePlayerAvatarPaths(
  playerId: string,
  previousAvatarUrl: string | null | undefined,
  keep: readonly string[] = [],
  origin: string | null = supabasePublicOrigin(),
): string[] {
  const paths = new Set(legacyPlayerAvatarPaths(playerId));

  const previousPath = previousAvatarUrl ? avatarStoragePathFromUrl(previousAvatarUrl, origin) : null;
  if (previousPath && isPlayerAvatarPath(playerId, previousPath)) {
    const original = isAvatarThumbPath(previousPath) ? avatarOriginalPath(previousPath) : previousPath;
    if (original && isAvatarOriginalPath(original)) {
      paths.add(original);
      paths.add(avatarThumbPath(original));
    }
  }

  for (const path of keep) paths.delete(path);
  return [...paths];
}
