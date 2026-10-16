import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { generateImage } from '@/lib/avatar/nanogpt';
import { composePrompt, validateChoices } from '@/lib/avatar/prompt-template';
import { checkAndRecordGeneration } from '@/lib/avatar/rate-limit';
import { supabase } from '@/lib/supabase/client';
import { insertGalleryItem } from '@/lib/supabase/queries/avatar-gallery';
import { AVATAR_BUCKET } from '@/lib/avatar/thumbnail-path';
import { AVATAR_IMMUTABLE_CACHE_CONTROL, tryWriteAvatarThumbnail } from '@/lib/avatar/thumbnail';
import { avatarGenerateSchema, formatZodErrors } from '@/lib/validation';
import type { ApiResult } from '@/types/api';
import type { AiAvatarChoices } from '@/types/avatar';

interface GenerateResponse {
  image: string; // base64 data URL
  remaining: number;
  gallery_id: string;
  gallery_url: string;
}

/**
 * POST /api/avatar/generate — Generate an AI avatar from user choices.
 * Body: { choices: AiAvatarChoices }
 * Returns: { image, remaining, gallery_id, gallery_url }
 *
 * The prompt is composed server-side from the choices — never sent to or from the client.
 * Every generation is persisted to the ai_avatar_gallery table for reuse, with a
 * 256 px WebP thumbnail stored next to the original (`<original>.thumb.webp`).
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

    // Parse and validate choices
    const rawBody = await request.json();
    const zodResult = avatarGenerateSchema.safeParse(rawBody);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const choices = zodResult.data.choices as unknown as AiAvatarChoices;

    const validationErrors = validateChoices(choices);
    if (validationErrors.length > 0) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Invalid choices', details: validationErrors.join('; '), code: 'avatar_choices_invalid' },
        { status: 400 }
      );
    }

    // Atomically check + record rate limit (prevents concurrent bypass)
    const rateLimit = await checkAndRecordGeneration(playerId);
    if (!rateLimit.allowed) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: `Generation limit reached (${rateLimit.limit} per day). Try again later.`,
          code: 'daily_limit_reached',
          params: { limit: rateLimit.limit },
        },
        { status: 429 }
      );
    }

    // Compose prompt from choices (server-side only — never sent to client)
    const prompt = composePrompt(choices);

    // Generate image via NanoGPT
    const image = await generateImage({ prompt });

    // ── Persist to gallery ──────────────────────────────────────
    // Decode base64 to upload to Supabase Storage
    const dataUrlMatch = image.match(/^data:(image\/[a-z+]+);base64,(.+)$/);
    const contentType = dataUrlMatch?.[1] ?? 'image/png';
    const base64Data = dataUrlMatch?.[2] ?? image;
    const buffer = Buffer.from(base64Data, 'base64');

    const ext = contentType === 'image/jpeg' ? 'jpg'
      : contentType === 'image/webp' ? 'webp'
      : 'png';

    const fileId = crypto.randomUUID();
    const filePath = `gallery/${playerId}/${fileId}.${ext}`;
    const avatarBucket = supabase.storage.from(AVATAR_BUCKET);

    // UUID path = immutable object, so it can be cached for a year.
    const { error: uploadError } = await avatarBucket.upload(filePath, buffer, {
      contentType,
      upsert: false,
      cacheControl: AVATAR_IMMUTABLE_CACHE_CONTROL,
    });

    if (uploadError) {
      console.error('Gallery upload failed:', uploadError.message);
      // Don't fail the whole request — the user still gets the image
      return NextResponse.json<ApiResult<GenerateResponse>>({
        success: true,
        data: {
          image,
          remaining: rateLimit.remaining - 1,
          gallery_id: '',
          gallery_url: '',
        },
      });
    }

    // 256 px WebP next to the original for the gallery grid and avatar_url.
    // Non-critical: the grid falls back to the original, the backfill retries.
    await tryWriteAvatarThumbnail(avatarBucket, filePath, buffer, 'avatar/generate');

    const { data: urlData } = avatarBucket.getPublicUrl(filePath);

    const galleryItem = await insertGalleryItem({
      player_id: playerId,
      image_url: urlData.publicUrl,
      choices,
      style: choices.art_style || 'anime',
    });

    // Return the image and updated remaining count
    const remaining = rateLimit.remaining - 1;

    return NextResponse.json<ApiResult<GenerateResponse>>({
      success: true,
      data: {
        image,
        remaining,
        gallery_id: galleryItem.id,
        gallery_url: urlData.publicUrl,
      },
    });
  } catch (error) {
    return safeErrorResponse(error, 'Image generation failed', 500, 'avatar_generation_failed');
  }
}
