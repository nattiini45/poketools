import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { getGalleryItem, deleteGalleryItem } from '@/lib/supabase/queries/avatar-gallery';
import { removeGalleryObject } from '@/lib/supabase/storage/avatars';
import { logger } from '@/lib/logger';
import type { ApiResult } from '@/types/api';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * DELETE /api/avatar/gallery/[id] — delete one of the authenticated player's gallery items.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const playerId = session.player?.playerId;

    if (!playerId) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Player registration required', code: 'player_registration_required' },
        { status: 403 }
      );
    }

    const { id } = await params;
    const invalidId = rejectInvalidPathId(id, 'INVALID_GALLERY_ITEM_ID');
    if (invalidId) return invalidId;

    const item = await getGalleryItem(id);
    if (!item) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Gallery item not found', code: 'gallery_item_not_found' },
        { status: 404 }
      );
    }

    if (item.player_id !== playerId) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Cannot delete another player\'s gallery item', code: 'gallery_item_delete_forbidden' },
        { status: 403 }
      );
    }

    const removal = await removeGalleryObject(item.image_url);
    if (removal.error) {
      logger.error('api/avatar/gallery', 'Gallery storage delete failed', {
        galleryId: id,
        error: removal.error,
      });
    }

    const deleted = await deleteGalleryItem(id, playerId);
    if (!deleted) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Gallery item not found', code: 'gallery_item_not_found' },
        { status: 404 }
      );
    }

    return NextResponse.json<ApiResult<{ id: string }>>({
      success: true,
      data: { id },
    });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to delete gallery item', 500, 'gallery_item_delete_failed');
  }
}
