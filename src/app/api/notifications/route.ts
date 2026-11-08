import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { parsePagination } from '@/lib/api/pagination';
import { requirePlayer } from '@/lib/auth/helpers';
import { loadInboxPage } from '@/lib/format-engine/notifications/server';
import { INBOX_PAGE_SIZE, type InboxPage } from '@/lib/format-engine/notifications/types';
import type { ApiResult } from '@/types/api';

/**
 * GET /api/notifications?limit&offset
 *
 * One page of the signed-in player's own format-league notifications, newest first, with the unread count. Always the guard's
 * player, never an id from the request. Every field goes through the masks of `toNotificationView`.
 */
export async function GET(request: NextRequest) {
  try {
    const player = await requirePlayer();
    const { limit, offset } = parsePagination(request.nextUrl.searchParams, { defaultLimit: INBOX_PAGE_SIZE, maxLimit: INBOX_PAGE_SIZE });
    const page = await loadInboxPage(player.playerId, limit, offset);
    return NextResponse.json<ApiResult<InboxPage>>({ success: true, data: page }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to load the notifications');
  }
}
