import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { logger } from '@/lib/logger';
import { socialImageSchema, formatZodErrors } from '@/lib/validation';
import { getMatchById, updateMatchSocialImageUrl } from '@/lib/supabase/queries/matches';
import { removeSocialImage, uploadSocialImage } from '@/lib/supabase/storage/social-images';
import { isSupabaseTimeoutError } from '@/lib/supabase/timeout-fetch';
import { isValidUuid } from '@/lib/utils/uuid';
import type { ApiResult } from '@/types/api';
import {
  SOCIAL_IMAGE_MAX_BYTES,
  socialImagePath,
  socialImagePathFromUrl,
} from '@/lib/match/social-image-path';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** 404 for an id that cannot name a match (Postgres would reject the filter with a 500). */
function invalidMatchId() {
  return NextResponse.json<ApiResult<never>>(
    { success: false, error: 'Match not found', code: 'INVALID_MATCH_ID' },
    { status: 404 },
  );
}

/**
 * POST /api/matches/[id]/social-image
 * Admin: upload a captured MatchHighlightCard PNG for social posting.
 * Body: { image: string (base64 data URL) }
 *
 * Each upload is a NEW immutable object (`src/lib/match/social-image-path.ts`) with a one-year
 * cache, so the stored URL changes with the image and no cache serves an old
 * card. The object it replaces is kept: a Discord or social post made with
 * the old URL keeps its image (DELETE removes the current object).
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    await requireAdmin();

    const { id } = await params;
    if (!isValidUuid(id)) return invalidMatchId();
    const match = await getMatchById(id);
    if (!match) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Match not found', code: 'match_not_found' },
        { status: 404 },
      );
    }

    const rawBody = await request.json();
    const zodResult = socialImageSchema.safeParse(rawBody);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 },
      );
    }
    const image = zodResult.data.image;

    // Decode base64 data URL
    const dataUrlMatch = image.match(/^data:(image\/[a-z+]+);base64,(.+)$/);
    const base64Data = dataUrlMatch?.[2] ?? image;
    const buffer = Buffer.from(base64Data, 'base64');

    if (buffer.length < 4) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Invalid image data', code: 'match_social_image_invalid' },
        { status: 400 },
      );
    }

    const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
    if (!PNG_MAGIC.every((byte, i) => buffer[i] === byte)) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Only PNG images are accepted', code: 'match_social_image_not_png' },
        { status: 400 },
      );
    }

    // Size limit: 5MB
    if (buffer.byteLength > SOCIAL_IMAGE_MAX_BYTES) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Image too large (max 5MB)', code: 'match_social_image_too_large' },
        { status: 400 },
      );
    }

    // A new immutable name per upload: never overwrite an object in place.
    const filePath = socialImagePath(match.id);

    const upload = await uploadSocialImage(filePath, buffer);

    if (upload.error) {
      // A Storage request deadline is its own cause (504 upstream_timeout), not the upload failure.
      if (isSupabaseTimeoutError(upload.error)) return safeErrorResponse(upload.error, 'Failed to upload social image');
      logger.error('api', 'Social image upload failed', { matchId: match.id, error: upload.error });
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Failed to upload social image', code: 'match_social_image_upload_failed' },
        { status: 500 },
      );
    }

    const publicUrl = upload.publicUrl;

    // Store URL on match record
    await updateMatchSocialImageUrl(match.id, publicUrl);

    return NextResponse.json<ApiResult<{ url: string }>>(
      { success: true, data: { url: publicUrl } },
      { status: 201 },
    );
  } catch (error) {
    return safeErrorResponse(error, 'Failed to upload social image');
  }
}

/**
 * DELETE /api/matches/[id]/social-image
 * Admin: remove social image from storage and match record.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    await requireAdmin();

    const { id } = await params;
    if (!isValidUuid(id)) return invalidMatchId();
    const match = await getMatchById(id);
    if (!match) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Match not found', code: 'match_not_found' },
        { status: 404 },
      );
    }

    // Remove the object the stored URL names (only a whitelisted object of
    // this match); a URL that names none (another origin, a foreign path) is
    // cleared without touching Storage.
    const filePath = match.social_image_url
      ? socialImagePathFromUrl(match.social_image_url, match.id)
      : null;
    if (filePath) {
      const { error: removeError } = await removeSocialImage(filePath);
      if (removeError) {
        // Keep the URL so the delete can be retried; clearing it would orphan the object.
        if (isSupabaseTimeoutError(removeError)) return safeErrorResponse(removeError, 'Failed to remove social image file');
        logger.error('api', 'Social image removal failed', { matchId: match.id, filePath, error: removeError });
        return NextResponse.json<ApiResult<never>>(
          { success: false, error: 'Failed to remove social image file', code: 'STORAGE_REMOVE_FAILED' },
          { status: 500 },
        );
      }
    } else if (match.social_image_url) {
      logger.warn('api', 'Social image URL names no removable object; clearing the column only', {
        matchId: match.id,
      });
    }
    await updateMatchSocialImageUrl(match.id, null);

    return NextResponse.json<ApiResult<null>>({ success: true, data: null });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to delete social image');
  }
}
