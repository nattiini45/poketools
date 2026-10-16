import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requireAuth } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { avatarUploadSchema, formatZodErrors } from '@/lib/validation';
import { getPlayerById, updatePlayer } from '@/lib/supabase/queries/players';
import { getGalleryItem } from '@/lib/supabase/queries/avatar-gallery';
import { supabase } from '@/lib/supabase/client';
import { validateAvatarConfig } from '@/lib/avatar/manifest';
import {
  AVATAR_BUCKET,
  avatarStoragePathFromUrl,
  avatarThumbPath,
  avatarThumbUrl,
  isAvatarOriginalPath,
  supabasePublicOrigin,
} from '@/lib/avatar/thumbnail-path';
import { isShowdownSpriteId, parseShowdownTrainerSpriteUrl } from '@/lib/avatar/showdown-sprite';
import {
  AVATAR_IMMUTABLE_CACHE_CONTROL,
  AvatarThumbnailError,
  avatarContentHash,
  createAvatarThumbnail,
  ensureAvatarThumbnail,
  playerAvatarUploadPath,
  putAvatarThumbnail,
  stalePlayerAvatarPaths,
  type AvatarBucket,
} from '@/lib/avatar/thumbnail';
import { expirePublicTags, publicTags } from '@/lib/revalidation';
import type { ApiResult } from '@/types/api';
import type { Player } from '@/types/player';
import type { AvatarConfig } from '@/types/avatar';

/**
 * Revalidate ISR-cached pages that display player avatars, and expire the
 * public read-cache entries that embed them (every such read carries
 * `publicTags.players`; the profile also carries `publicTags.player(id)`).
 */
function revalidateAvatarPages(playerId: string): void {
  revalidatePath('/');
  revalidatePath('/tournaments');
  revalidatePath('/leagues');
  expirePublicTags([publicTags.players, publicTags.player(playerId)]);
}

/**
 * Remove the player's superseded avatar objects (legacy stable names and the
 * previous versioned original + thumbnail) once the new avatar_url is saved.
 * Cleanup never fails the request: the avatar is already set, so a failure is
 * logged with its own tag and the orphan is removed on the next change.
 */
async function removeStalePlayerAvatarFiles(
  bucket: AvatarBucket,
  playerId: string,
  previousAvatarUrl: string | null,
  keep: string[],
): Promise<void> {
  const stale = stalePlayerAvatarPaths(playerId, previousAvatarUrl, keep);
  if (stale.length === 0) return;
  try {
    const { error } = await bucket.remove(stale);
    if (error) console.error('[API] Old avatar files could not be removed:', error.message);
  } catch (err) {
    console.error('[API] Old avatar file cleanup threw:', err);
  }
}

/**
 * Remove a just-uploaded original and thumbnail after the player row update
 * failed. Their content-hashed names are never named by
 * `stalePlayerAvatarPaths`, so nothing later would remove them. Best effort:
 * the objects stay (logged) when the row cannot be re-read, or when its
 * avatar_url names one of them (the same image is already the avatar, or the
 * failed update committed after all), so avatar_url never points at a deleted
 * object.
 */
async function removeUnsavedAvatarUpload(
  bucket: AvatarBucket,
  playerId: string,
  uploaded: string[],
): Promise<void> {
  try {
    const current = await getPlayerById(playerId);
    const currentPath = current?.avatar_url
      ? avatarStoragePathFromUrl(current.avatar_url, supabasePublicOrigin())
      : null;
    if (currentPath && uploaded.includes(currentPath)) return;
    const { error } = await bucket.remove(uploaded);
    if (error) console.error('[API] Unsaved avatar upload could not be removed:', error.message);
  } catch (err) {
    console.error('[API] Unsaved avatar upload cleanup threw:', err);
  }
}

/**
 * avatar_url for a gallery image: its thumbnail, created on first use if the
 * item predates thumbnails. If the thumbnail cannot be made the original is
 * used (logged); the admin backfill picks the player up later.
 */
async function galleryAvatarUrl(bucket: AvatarBucket, imageUrl: string): Promise<string> {
  const origin = supabasePublicOrigin();
  const originalPath = avatarStoragePathFromUrl(imageUrl, origin);
  const thumbUrl = avatarThumbUrl(imageUrl, origin);
  if (!originalPath || !thumbUrl || !isAvatarOriginalPath(originalPath)) return imageUrl;

  try {
    await ensureAvatarThumbnail(bucket, originalPath);
    return thumbUrl;
  } catch (err) {
    const stage = err instanceof AvatarThumbnailError ? err.stage : 'unknown';
    console.error(`[API] Gallery avatar thumbnail failed at ${stage}; using the original:`, err);
    return imageUrl;
  }
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/players/[id]/avatar — Upload a composed avatar.
 * Body: { image: string (base64 data URL), config: AvatarConfig }
 *
 * Uploads are stored under a content-hashed name with a 256 px WebP thumbnail
 * next to them (both cached for a year); avatar_url points at the thumbnail.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const session = await requireAuth();
    const playerId = id;

    // Only allow own profile or admin
    const isOwn = session.player?.playerId === playerId;
    const isAdmin = session.player?.isAdmin === true;
    if (!isOwn && !isAdmin) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Not authorized to edit this avatar', code: 'avatar_edit_forbidden' },
        { status: 403 }
      );
    }

    // Verify player exists
    const player = await getPlayerById(playerId);
    if (!player) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Player not found', code: 'player_not_found' },
        { status: 404 }
      );
    }

    const rawBody = await request.json();
    const zodResult = avatarUploadSchema.safeParse(rawBody);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }
    const body = zodResult.data;

    const avatarBucket = supabase.storage.from(AVATAR_BUCKET);
    // Storage names use the id read from the DB, never the raw route param.
    const storagePlayerId = player.id;
    const previousAvatarUrl = player.avatar_url;

    // ── Showdown sprite shortcut ──────────────────────────────────
    // Body: { showdown_sprite: string, sprite_url: string }
    if (body.showdown_sprite && body.sprite_url) {
      const spriteId = body.showdown_sprite;
      if (!isShowdownSpriteId(spriteId)) {
        return NextResponse.json<ApiResult<never>>(
          { success: false, error: 'Invalid Showdown sprite id', code: 'showdown_sprite_invalid' },
          { status: 400 }
        );
      }

      // Parsed, not prefix-matched: only https://play.pokemonshowdown.com/sprites/trainers/<id>.png
      // for this sprite id, with no query or fragment. A prefix check let
      // `…/trainers/x/storage/v1/object/public/avatars/..%2F…` through.
      const sprite = parseShowdownTrainerSpriteUrl(body.sprite_url);
      if (!sprite || sprite.spriteId !== spriteId) {
        return NextResponse.json<ApiResult<never>>(
          { success: false, error: 'Invalid Showdown sprite URL', code: 'showdown_sprite_url_invalid' },
          { status: 400 }
        );
      }

      // Store the canonical Showdown CDN URL directly — no need to re-upload
      const updated = await updatePlayer(playerId, {
        avatar_url: sprite.url,
        avatar_config: { type: 'showdown', spriteId } as unknown as AvatarConfig,
      });

      await removeStalePlayerAvatarFiles(avatarBucket, storagePlayerId, previousAvatarUrl, []);
      revalidateAvatarPages(playerId);
      return NextResponse.json<ApiResult<Player>>({ success: true, data: updated });
    }

    // ── Gallery image reuse ──────────────────────────────────────
    // Body: { gallery_id: string }
    if (body.gallery_id) {
      const galleryId = body.gallery_id as string;
      const galleryItem = await getGalleryItem(galleryId);

      if (!galleryItem) {
        return NextResponse.json<ApiResult<never>>(
          { success: false, error: 'Gallery item not found', code: 'gallery_item_not_found' },
          { status: 404 }
        );
      }

      // Only allow reusing your own gallery items
      if (galleryItem.player_id !== playerId) {
        return NextResponse.json<ApiResult<never>>(
          { success: false, error: 'Cannot use another player\'s gallery image', code: 'gallery_item_not_owned' },
          { status: 403 }
        );
      }

      // Point avatar_url at the gallery image's thumbnail (no re-upload)
      const avatarUrl = await galleryAvatarUrl(avatarBucket, galleryItem.image_url);
      const updated = await updatePlayer(playerId, {
        avatar_url: avatarUrl,
        avatar_config: { type: 'ai', gallery_id: galleryId } as unknown as AvatarConfig,
      });

      await removeStalePlayerAvatarFiles(avatarBucket, storagePlayerId, previousAvatarUrl, []);
      revalidateAvatarPages(playerId);
      return NextResponse.json<ApiResult<Player>>({ success: true, data: updated });
    }

    // ── Standard avatar upload (Build / AI) ──────────────────────
    const { image, config } = body as { image: string; config: AvatarConfig };

    if (!image || !config) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Missing required fields: image, config', code: 'avatar_fields_missing' },
        { status: 400 }
      );
    }

    // Validate the config against the manifest (skip for AI-generated avatars with empty/no-gender config)
    const isAiGenerated = !config || Object.keys(config).length === 0 || !('gender' in config);
    if (!isAiGenerated) {
      const errors = validateAvatarConfig(config);
      if (errors.length > 0) {
        return NextResponse.json<ApiResult<never>>(
          { success: false, error: 'Invalid avatar config', details: errors.join('; '), code: 'avatar_config_invalid' },
          { status: 400 }
        );
      }
    }

    // Decode base64 image (strip any data URL prefix)
    const dataUrlMatch = image.match(/^data:(image\/[a-z+]+);base64,(.+)$/);
    const base64Data = dataUrlMatch?.[2] ?? image;
    const buffer = Buffer.from(base64Data, 'base64');

    if (buffer.length < 12) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'File too small to be a valid image', code: 'avatar_image_too_small' },
        { status: 400 }
      );
    }

    const MAGIC_BYTES: [string, number[]][] = [
      ['image/jpeg', [0xff, 0xd8, 0xff]],
      ['image/png', [0x89, 0x50, 0x4e, 0x47]],
      ['image/webp', [0x52, 0x49, 0x46, 0x46]],
    ];
    let detectedMime: string | null = null;
    for (const [mime, sig] of MAGIC_BYTES) {
      if (sig.every((byte, i) => buffer[i] === byte)) {
        detectedMime = mime;
        break;
      }
    }
    if (!detectedMime) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Unsupported image format. Use JPEG, PNG, or WebP.', code: 'avatar_image_format_unsupported' },
        { status: 400 }
      );
    }

    const contentType = dataUrlMatch?.[1];
    if (contentType && contentType !== detectedMime) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Image format mismatch', code: 'avatar_image_format_mismatch' },
        { status: 400 }
      );
    }

    const effectiveContentType = detectedMime;

    // Size limit: 500KB for layer-built, 5MB for AI-generated
    const maxSize = isAiGenerated ? 5 * 1024 * 1024 : 500 * 1024;
    if (buffer.byteLength > maxSize) {
      const max = isAiGenerated ? '5MB' : '500KB';
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: `Avatar image too large (max ${max})`, code: 'avatar_image_too_large', params: { max } },
        { status: 400 }
      );
    }

    // Build the thumbnail before any write: decoding it also proves the image is readable.
    let thumbnail: Buffer;
    try {
      thumbnail = await createAvatarThumbnail(buffer);
    } catch (err) {
      console.error('[API] Avatar thumbnail could not be created:', err);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Avatar image could not be processed', code: 'avatar_image_unprocessable' },
        { status: 400 }
      );
    }

    // Determine file extension from content type
    const ext = effectiveContentType === 'image/jpeg' ? 'jpg'
      : effectiveContentType === 'image/webp' ? 'webp'
      : 'png';
    // Content-hashed name: a new image gets a new URL, so the 1-year cache is safe.
    const filePath = playerAvatarUploadPath(storagePlayerId, avatarContentHash(buffer), ext);
    const thumbPath = avatarThumbPath(filePath);

    // Upload to Supabase Storage (same name = same bytes, so upsert is harmless)
    const { error: uploadError } = await avatarBucket.upload(filePath, buffer, {
      contentType: effectiveContentType,
      cacheControl: AVATAR_IMMUTABLE_CACHE_CONTROL,
      upsert: true,
    });

    if (uploadError) {
      console.error('[API] Avatar upload failed:', uploadError.message);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Failed to upload avatar', code: 'avatar_upload_failed' },
        { status: 500 }
      );
    }

    try {
      await putAvatarThumbnail(avatarBucket, filePath, thumbnail);
    } catch (err) {
      console.error('[API] Avatar thumbnail upload failed:', err);
      // Best effort: do not leave an unreferenced original behind — unless the
      // current avatar is this same image (same content hash), which must stay.
      const previousPath = previousAvatarUrl
        ? avatarStoragePathFromUrl(previousAvatarUrl, supabasePublicOrigin())
        : null;
      if (previousPath !== filePath && previousPath !== thumbPath) {
        const { error: rollbackError } = await avatarBucket.remove([filePath]);
        if (rollbackError) {
          console.error('[API] Avatar original rollback failed:', rollbackError.message);
        }
      }
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Failed to upload avatar thumbnail', code: 'avatar_thumbnail_upload_failed' },
        { status: 500 }
      );
    }

    // Get the thumbnail's public URL
    const { data: urlData } = avatarBucket.getPublicUrl(thumbPath);

    // Update player record. On failure the new objects are unreferenced:
    // remove them, then let the route's catch answer.
    let updated: Player;
    try {
      updated = await updatePlayer(playerId, {
        avatar_url: urlData.publicUrl,
        avatar_config: config,
      });
    } catch (err) {
      await removeUnsavedAvatarUpload(avatarBucket, playerId, [filePath, thumbPath]);
      throw err;
    }

    await removeStalePlayerAvatarFiles(avatarBucket, storagePlayerId, previousAvatarUrl, [filePath, thumbPath]);
    revalidateAvatarPages(playerId);
    return NextResponse.json<ApiResult<Player>>({ success: true, data: updated });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to upload avatar', 500, 'avatar_upload_failed');
  }
}

/**
 * DELETE /api/players/[id]/avatar — Remove custom avatar (revert to Discord).
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const session = await requireAuth();
    const playerId = id;

    const isOwn = session.player?.playerId === playerId;
    const isAdmin = session.player?.isAdmin === true;
    if (!isOwn && !isAdmin) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Not authorized to edit this avatar', code: 'avatar_edit_forbidden' },
        { status: 403 }
      );
    }

    const player = await getPlayerById(playerId);
    if (!player) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Player not found', code: 'player_not_found' },
        { status: 404 }
      );
    }

    // Clear player avatar fields first, so avatar_url never points at a deleted object
    const updated = await updatePlayer(playerId, {
      avatar_url: null,
      avatar_config: null,
    });

    // Then delete the player's own avatar objects (legacy names + current version).
    // Gallery images are left alone: the gallery owns them.
    await removeStalePlayerAvatarFiles(
      supabase.storage.from(AVATAR_BUCKET),
      player.id,
      player.avatar_url,
      [],
    );

    revalidateAvatarPages(playerId);
    return NextResponse.json<ApiResult<Player>>({ success: true, data: updated });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to delete avatar', 500, 'avatar_delete_failed');
  }
}
