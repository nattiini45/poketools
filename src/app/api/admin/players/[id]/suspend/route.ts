import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { adminPlayerDisciplineSchema, formatZodErrors } from '@/lib/validation';
import { suspendPlayer, banPlayer } from '@/lib/supabase/queries/players';
import { logAuditEvent } from '@/lib/audit/log';
import type { ApiResult } from '@/types/api';
import type { Player } from '@/types/player';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

/** POST /api/admin/players/[id]/suspend — suspend or ban a player */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    const invalidId = rejectInvalidPathId(id, 'INVALID_PLAYER_ID');
    if (invalidId) return invalidId;
    const body = await request.json().catch(() => null);

    const zodResult = adminPlayerDisciplineSchema.safeParse(body);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }
    const parsedBody = zodResult.data;

    let player: Player;

    if (parsedBody.type === 'ban') {
      player = await banPlayer(id, parsedBody.ban_reason);
      logAuditEvent({
        actor_id: admin.playerId,
        actor_name: admin.name,
        action: 'player.ban',
        resource_type: 'player',
        resource_id: id,
        resource_name: player.name,
        metadata: { reason: parsedBody.ban_reason },
      });
    } else {
      player = await suspendPlayer(id, parsedBody.suspended_until);
      logAuditEvent({
        actor_id: admin.playerId,
        actor_name: admin.name,
        action: 'player.suspend',
        resource_type: 'player',
        resource_id: id,
        resource_name: player.name,
        metadata: { suspended_until: parsedBody.suspended_until },
      });
    }

    return NextResponse.json<ApiResult<Player>>({ success: true, data: player });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to suspend player');
  }
}