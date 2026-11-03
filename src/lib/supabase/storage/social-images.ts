import { supabase } from '../client';
import { SOCIAL_IMAGE_BUCKET, SOCIAL_IMAGE_CACHE_CONTROL } from '@/lib/match/social-image-path';

/**
 * Match social images in the `social-images` bucket. Every upload is a new immutable object
 * (`socialImagePath` in `src/lib/match/social-image-path.ts`, `upsert: false`); a stored URL becomes a removable
 * path only through `socialImagePathFromUrl` in the same file, which the caller applies before `removeSocialImage`.
 */

export type SocialImageUpload =
  | { publicUrl: string; error: null }
  | { publicUrl: null; error: { message: string } };

/** Upload a PNG at `path` and return its public URL; the error of a failed upload is returned, not thrown. */
export async function uploadSocialImage(path: string, png: Buffer): Promise<SocialImageUpload> {
  const { error } = await supabase.storage.from(SOCIAL_IMAGE_BUCKET).upload(path, png, {
    contentType: 'image/png',
    cacheControl: SOCIAL_IMAGE_CACHE_CONTROL,
    upsert: false,
  });
  if (error) return { publicUrl: null, error };

  const { data } = supabase.storage.from(SOCIAL_IMAGE_BUCKET).getPublicUrl(path);
  return { publicUrl: data.publicUrl, error: null };
}

/** Remove one object; the error of a failed removal is returned, not thrown. */
export async function removeSocialImage(path: string): Promise<{ error: { message: string } | null }> {
  const { error } = await supabase.storage.from(SOCIAL_IMAGE_BUCKET).remove([path]);
  return { error };
}
