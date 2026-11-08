import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { safeErrorResponse } from '@/lib/api/error-response';
import { requirePlayer } from '@/lib/auth/helpers';
import { MARK_READ_MAX_IDS, type UnreadCount } from '@/lib/format-engine/notifications/types';
import { readBoundedJson } from '@/lib/format-engine/runtime/api-body';
import { SMALL_BODY_MAX_BYTES } from '@/lib/format-engine/runtime/api-schemas';
import { validationFailedResponse } from '@/lib/format-studio/api-schemas';
import { UUID_PATTERN } from '@/lib/studio-core/keys';
import { countUnreadFormatNotifications, markFormatNotificationsRead } from '@/lib/supabase/queries/format-notifications';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';

const NOTIFICATIONS_READ_LIMIT = { bucket: 'notifications-read', limit: 120, windowSeconds: 60 } as const;

const readBody = z.union([
  z.strictObject({ ids: z.array(z.string().regex(UUID_PATTERN)).min(1).max(MARK_READ_MAX_IDS) }),
  z.strictObject({ all: z.literal(true) }),
]);

/**
 * POST /api/notifications/read
 *
 * Marks notifications of the signed-in player read: `{ ids: [...] }` or `{ all: true }`. The write is scoped to the guard's
 * player, so an id of somebody else's row changes nothing. Answers the new unread count.
 */
export async function POST(request: NextRequest) {
  try {
    const player = await requirePlayer();

    const rate = await checkRateLimit(NOTIFICATIONS_READ_LIMIT.bucket, player.playerId, NOTIFICATIONS_READ_LIMIT);
    if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);

    const parsed = readBody.safeParse(await readBoundedJson(request, SMALL_BODY_MAX_BYTES));
    if (!parsed.success) return validationFailedResponse(parsed.error);

    await markFormatNotificationsRead(player.playerId, 'all' in parsed.data ? 'all' : parsed.data.ids.map((id) => id.toLowerCase()));
    const unread = await countUnreadFormatNotifications(player.playerId);
    return NextResponse.json<ApiResult<UnreadCount>>({ success: true, data: { unread } });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to mark the notifications read');
  }
}
