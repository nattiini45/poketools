import { NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { revokePlayerSessions } from '@/lib/supabase/queries/players';
import { logAuditEvent } from '@/lib/audit/log';
import { safeErrorResponse } from '@/lib/api/error-response';
import type { ApiResult } from '@/types/api';

/**
 * POST /api/account/sessions/revoke
 *
 * "Sign out everywhere": moves the signed-in player's session epoch
 * (`players.sessions_valid_after`) to now, so every token issued before it
 * (this browser's included, on both login methods) answers 401 from here on.
 * A new sign-in works as usual. The client ends its own session afterwards.
 *
 * Ownership is by construction: the write targets `player.playerId` from the
 * live guard, never an id from the request.
 */
export async function POST() {
  try {
    const player = await requirePlayer();

    await revokePlayerSessions(player.playerId);

    logAuditEvent({
      actor_id: player.playerId,
      actor_name: player.name,
      action: 'player.sessions_revoke',
      resource_type: 'player',
      resource_id: player.playerId,
      resource_name: player.name,
    });

    return NextResponse.json<ApiResult<{ revoked: true }>>({ success: true, data: { revoked: true } });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to sign out everywhere', 500, 'session_revoke_failed');
  }
}
