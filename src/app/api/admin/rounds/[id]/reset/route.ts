import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { cascadeActionSchema, formatZodErrors } from '@/lib/validation';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import { resetRound } from '@/lib/pkmn/game-pipeline';
import { revalidateMatchPages } from '@/lib/revalidation';
import { supabase } from '@/lib/supabase/client';
import { logAuditEvent } from '@/lib/audit/log';
import type { ApiResult } from '@/types/api';
import type { ResetRoundResult } from '@/types/game';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** POST /api/admin/rounds/[id]/reset — reset all matches in a round */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const player = await requirePlayer();
    const { id } = await params;

    // Get round → tournament_id for auth check
    const { data: round, error: roundErr } = await supabase
      .from('rounds')
      .select('name, tournament_id')
      .eq('id', id)
      .maybeSingle();

    if (roundErr) throw roundErr;
    if (!round) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Round not found', code: 'round_not_found' },
        { status: 404 }
      );
    }

    const hasAdminAccess = player.isAdmin ||
      await isResourceAdminFor(player.playerId, 'tournament', round.tournament_id);

    if (!hasAdminAccess) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Admin access required', code: 'forbidden' },
        { status: 403 }
      );
    }

    let rawBody: unknown = {};
    try {
      rawBody = await request.json();
    } catch {
      rawBody = {};
    }
    const parsed = cascadeActionSchema.safeParse(rawBody ?? {});
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const result = await resetRound(id, player.playerId, parsed.data.cascade === true);

    await revalidateMatchPages(round.tournament_id);

    logAuditEvent({
      actor_id: player.playerId,
      actor_name: player.name,
      action: 'round.reset',
      resource_type: 'round',
      resource_id: id,
      resource_name: round.name,
      metadata: {
        tournament_id: round.tournament_id,
        matches_reset: result.matches_reset,
        total_games_deleted: result.total_games_deleted,
        cascade: parsed.data.cascade === true,
      },
    });

    return NextResponse.json<ApiResult<ResetRoundResult>>({
      success: true,
      data: result,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to reset round');
  }
}
