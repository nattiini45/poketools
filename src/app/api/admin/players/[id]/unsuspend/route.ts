import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { unsuspendPlayer } from '@/lib/supabase/queries/players';
import { logAuditEvent } from '@/lib/audit/log';
import type { ApiResult } from '@/types/api';
import type { Player } from '@/types/player';

/** POST /api/admin/players/[id]/unsuspend — reinstate a suspended or banned player */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;

    const player = await unsuspendPlayer(id);
    logAuditEvent({
      actor_id: admin.playerId,
      actor_name: admin.name,
      action: 'player.unsuspend',
      resource_type: 'player',
      resource_id: id,
      resource_name: player.name,
    });

    return NextResponse.json<ApiResult<Player>>({ success: true, data: player });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to reinstate player');
  }
}