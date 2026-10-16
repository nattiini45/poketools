import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { requireAuth } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { checkAndRecordGeneration } from '@/lib/avatar/rate-limit';
import { validateUpload, moderateImage, transformToTrainer, isModerationRequired } from '@/lib/avatar/transform';
import { PHOTO_TRANSFORM_CONSENT_VERSION } from '@/lib/avatar/consent';
import { supabase } from '@/lib/supabase/client';
import { AVATAR_BUCKET } from '@/lib/avatar/thumbnail-path';
import { AVATAR_IMMUTABLE_CACHE_CONTROL, tryWriteAvatarThumbnail } from '@/lib/avatar/thumbnail';
import { avatarTransformSchema, formatZodErrors } from '@/lib/validation';
import type { ApiResult } from '@/types/api';
import type { Database } from '@/types/database';

interface TransformResponse {
  image: string; // base64 data URL
  remaining: number;
  gallery_id: string;
  gallery_url: string;
}

type GalleryInsertRow = Database['public']['Tables']['ai_avatar_gallery']['Insert'];

/**
 * POST /api/avatar/transform — Transform a photo into a Pokemon trainer sprite.
 *
 * Synchronous v1: moderate → sharp normalize → Replicate generate → return.
 * Original photo is held in memory only and never persisted. The generated
 * sprite is stored in the gallery with a 256 px WebP thumbnail next to it.
 *
 * Body: { image: string (base64 data URL) }
 * Returns: { image, remaining, gallery_id, gallery_url }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    const playerId = session.player?.playerId;

    if (!playerId) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Player registration required', code: 'player_registration_required' },
        { status: 403 }
      );
    }

    // Parse and validate body
    const rawBody = await request.json();
    const zodResult = avatarTransformSchema.safeParse(rawBody);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const imageInput = zodResult.data.image;

    if (zodResult.data.consentVersion !== PHOTO_TRANSFORM_CONSENT_VERSION) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Consent text has changed. Please review and accept again.', code: 'avatar_consent_outdated' },
        { status: 400 }
      );
    }

    // ── 1. Validate upload (size, MIME, magic bytes) ──────────
    const validation = validateUpload(imageInput);
    if (!validation.valid || !validation.buffer) {
      // validateUpload pairs each English message with its catalog code; a
      // failure without a message is the generic invalid-image answer.
      const code = validation.error ? validation.code : 'avatar_image_invalid';
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: validation.error ?? 'Invalid image',
          ...(code ? { code } : {}),
          ...(validation.params ? { params: validation.params } : {}),
        },
        { status: 400 }
      );
    }

    // ── 2. Rate limit (shared 10/day with AI generation) ─────
    // Atomically checks + records to prevent concurrent bypass
    const rateLimit = await checkAndRecordGeneration(playerId);
    if (!rateLimit.allowed) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: `Transform limit reached (${rateLimit.limit} per day). Try again later.`,
          code: 'daily_limit_reached',
          params: { limit: rateLimit.limit },
        },
        { status: 429 }
      );
    }

    // ── 3. Strip EXIF + normalize via Sharp ──────────────────
    const cleanBuffer = await sharp(validation.buffer)
      .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 92 })
      .toBuffer();

    // ── 4. Moderate with Azure Content Safety ────────────────
    const moderation = await moderateImage(cleanBuffer);
    if (moderation.unavailable) {
      if (isModerationRequired()) {
        return NextResponse.json<ApiResult<never>>(
          {
            success: false,
            error: 'Image safety checks are currently unavailable. Please try again later.',
            code: 'avatar_moderation_unavailable',
          },
          { status: 503 }
        );
      }
      console.warn('Moderation unavailable — proceeding because AVATAR_MODERATION_REQUIRED=false');
    } else if (!moderation.safe) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: "This image couldn't be processed. Please try a different photo.",
          code: 'avatar_image_rejected',
        },
        { status: 422 }
      );
    }

    // ── 5. Transform via Replicate ───────────────────────────
    const result = await transformToTrainer(cleanBuffer);

    // ── 6. Persist result to gallery ─────────────────────────
    // (Rate limit already recorded atomically in step 2)
    const dataUrlMatch = result.image.match(/^data:(image\/[a-z+]+);base64,(.+)$/);
    const contentType = dataUrlMatch?.[1] ?? 'image/png';
    const resultBase64 = dataUrlMatch?.[2] ?? result.image;
    const resultBuffer = Buffer.from(resultBase64, 'base64');

    const ext = contentType === 'image/jpeg' ? 'jpg'
      : contentType === 'image/webp' ? 'webp'
      : 'png';

    const fileId = crypto.randomUUID();
    const filePath = `gallery/${playerId}/${fileId}.${ext}`;
    const avatarBucket = supabase.storage.from(AVATAR_BUCKET);

    // UUID path = immutable object, so it can be cached for a year.
    const { error: uploadError } = await avatarBucket.upload(filePath, resultBuffer, {
      contentType,
      upsert: false,
      cacheControl: AVATAR_IMMUTABLE_CACHE_CONTROL,
    });

    if (uploadError) {
      console.error('Transform gallery upload failed:', uploadError.message);
      // Still return the image — gallery persistence is non-critical
      return NextResponse.json<ApiResult<TransformResponse>>({
        success: true,
        data: {
          image: result.image,
          remaining: rateLimit.remaining - 1,
          gallery_id: '',
          gallery_url: '',
        },
      });
    }

    // 256 px WebP next to the original for the gallery grid and avatar_url.
    // Non-critical: the grid falls back to the original, the backfill retries.
    await tryWriteAvatarThumbnail(avatarBucket, filePath, resultBuffer, 'avatar/transform');

    const { data: urlData } = avatarBucket.getPublicUrl(filePath);

    // Store in gallery with a marker for photo transforms
    const galleryPayload: GalleryInsertRow = {
      player_id: playerId,
      image_url: urlData.publicUrl,
      choices: { type: 'photo_transform' } as GalleryInsertRow['choices'],
      style: 'pixel_sprite',
    };

    const { data: galleryItem, error: galleryError } = await supabase
      .from('ai_avatar_gallery')
      .insert(galleryPayload)
      .select('id')
      .single();

    if (galleryError) {
      console.error('Gallery insert failed:', galleryError.message);
    }

    const remaining = rateLimit.remaining - 1;

    return NextResponse.json<ApiResult<TransformResponse>>({
      success: true,
      data: {
        image: result.image,
        remaining,
        gallery_id: galleryItem?.id ?? '',
        gallery_url: urlData.publicUrl,
      },
    });
  } catch (error) {
    return safeErrorResponse(error, 'Photo transform failed', 500, 'avatar_transform_failed');
  }
}
