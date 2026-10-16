import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { getGalleryItem, deleteGalleryItem } from '@/lib/supabase/queries/avatar-gallery';
import { supabase } from '@/lib/supabase/client';
import type { ApiResult } from '@/types/api';

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

    const storagePath = extractAvatarStoragePath(item.image_url);
    if (storagePath) {
      const { error: removeError } = await supabase.storage
        .from('avatars')
        .remove([storagePath]);

      if (removeError) {
        console.error('Gallery storage delete failed:', removeError.message);
      }
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

function extractAvatarStoragePath(publicUrl: string): string | null {
  try {
    const { pathname } = new URL(publicUrl);
    const marker = '/storage/v1/object/public/avatars/';
    const markerIndex = pathname.indexOf(marker);
    if (markerIndex < 0) return null;

    const encodedPath = pathname.slice(markerIndex + marker.length);
    if (!encodedPath) return null;

    return decodeURIComponent(encodedPath);
  } catch {
    return null;
  }
}
