import { NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { requirePlayer } from '@/lib/auth/helpers';
import type { UnreadCount } from '@/lib/format-engine/notifications/types';
import { countUnreadFormatNotifications } from '@/lib/supabase/queries/format-notifications';
import type { ApiResult } from '@/types/api';

/**
 * GET /api/notifications/unread-count
 *
 * The number on the bell, polled by a visible tab: one guard read and one head count on a partial index.
 */
export async function GET() {
  try {
    const player = await requirePlayer();
    const unread = await countUnreadFormatNotifications(player.playerId);
    return NextResponse.json<ApiResult<UnreadCount>>({ success: true, data: { unread } }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to count the notifications');
  }
}
