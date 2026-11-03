import { supabase } from '../client';
import { AVATAR_BUCKET, AVATAR_PUBLIC_PATH_MARKER } from '@/lib/avatar/thumbnail-path';
import type { AvatarBucket } from '@/lib/avatar/thumbnail';

/**
 * The service-role handle on the `avatars` bucket. Route handlers get Storage only through this module, so no
 * route imports the service-role client. The URL-to-path checks stay in `src/lib/avatar/thumbnail-path.ts`
 * (`avatarStoragePathFromUrl`, `isAvatarOriginalPath`): a stored URL becomes an object path only through them,
 * except for the gallery removal below, which keeps its pre-existing rule.
 */
export function getAvatarBucket(): AvatarBucket {
  return supabase.storage.from(AVATAR_BUCKET);
}

/**
 * Object path inside the `avatars` bucket named by a gallery item's public URL, or null when the URL carries no
 * `/storage/v1/object/public/avatars/` path. Gallery URLs are written by the server (`avatar/generate`,
 * `avatar/transform`), never taken from a request.
 */
export function galleryObjectPath(publicUrl: string): string | null {
  try {
    const { pathname } = new URL(publicUrl);
    const markerIndex = pathname.indexOf(AVATAR_PUBLIC_PATH_MARKER);
    if (markerIndex < 0) return null;

    const encodedPath = pathname.slice(markerIndex + AVATAR_PUBLIC_PATH_MARKER.length);
    if (!encodedPath) return null;

    return decodeURIComponent(encodedPath);
  } catch {
    return null;
  }
}

export interface GalleryRemoval {
  /** False when the URL names no object, so Storage was not called. */
  attempted: boolean;
  /** The Storage error of a failed removal; null on success or when nothing was attempted. */
  error: { message: string } | null;
}

/** Remove the object a gallery item's URL names (the original; its thumbnail is left to the backfill). */
export async function removeGalleryObject(publicUrl: string): Promise<GalleryRemoval> {
  const path = galleryObjectPath(publicUrl);
  if (!path) return { attempted: false, error: null };
  const { error } = await getAvatarBucket().remove([path]);
  return { attempted: true, error };
}
