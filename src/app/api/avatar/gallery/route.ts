import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { getPlayerGallery, getCommunityAvatars } from '@/lib/supabase/queries/avatar-gallery';
import type { ApiResult } from '@/types/api';
import type { AiGalleryItem } from '@/types/avatar';

/**
 * GET /api/avatar/gallery?scope=personal|community
 * Returns AI avatar gallery items for the authenticated user or community.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const playerId = session.player?.playerId;

    if (!playerId) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Player registration required', code: 'player_registration_required' },
        { status: 403 }
      );
    }

    const scope = request.nextUrl.searchParams.get('scope') || 'personal';

    let items: AiGalleryItem[];

    if (scope === 'community') {
      items = await getCommunityAvatars(playerId);
    } else {
      items = await getPlayerGallery(playerId);
    }

    return NextResponse.json<ApiResult<{ items: AiGalleryItem[] }>>({
      success: true,
      data: { items },
    });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to fetch gallery');
  }
}
