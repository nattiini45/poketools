import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { getPhaseRouteMode, requireOpenPhaseRouteMode } from '@/lib/league-phase/route-mode';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { getPhaseMatchById } from '@/lib/supabase/queries/phase-matches';
import { findNativePhaseAliasOwner, standaloneMatchAliasExists } from '@/lib/supabase/queries/phase-route-owners';
import { createPhaseMoment, getPhaseMomentsByMatch } from '@/lib/supabase/queries/phase-broadcast-moments';
import { isValidUuid } from '@/lib/utils/uuid';
import {
  getMomentsByMatch,
  createMoment,
} from '@/lib/supabase/queries/broadcast-moments';
import type { ApiResult } from '@/types/api';
import type { BroadcastMoment, BroadcastMomentInsert } from '@/types/broadcast';
import { broadcastMomentSchema, formatZodErrors } from '@/lib/validation';

/** GET /api/broadcast/moments?match_id=xxx */
// Public: no auth required
export async function GET(request: NextRequest) {
  try {
    const matchId = request.nextUrl.searchParams.get('match_id');
    if (!matchId) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'match_id is required', code: 'broadcast_match_id_required' },
        { status: 400 }
      );
    }
    // Postgres rejects a non-UUID filter (a 500): refuse it here as a coded 400.
    if (!isValidUuid(matchId)) {
      const issues = 'match_id: must be a UUID';
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const mode = await getPhaseRouteMode();
    const native = mode === 'phase' || mode === 'frozen_phase';
    const owner = native ? await findNativePhaseAliasOwner({ matchId }) : null;
    const moments = owner ? await getPhaseMomentsByMatch(matchId)
      : !native || await standaloneMatchAliasExists(matchId) ? await getMomentsByMatch(matchId) : [];
    return NextResponse.json<ApiResult<BroadcastMoment[]>>({
      success: true,
      data: moments,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch broadcast moments');
  }
}

/** POST /api/broadcast/moments — create a broadcast moment */
export async function POST(request: NextRequest) {
  try {
    const player = await requirePlayer();
    const rawBody = await request.json();
    const zodResult = broadcastMomentSchema.safeParse(rawBody);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }
    const body = zodResult.data;

    // Verify authorization: match participant, creator, or admin
    const mode = await requireOpenPhaseRouteMode();
    const nativeMatch = mode === 'phase' ? await getPhaseMatchById(body.match_id) : null;
    const match = nativeMatch ?? (mode === 'legacy' || await standaloneMatchAliasExists(body.match_id)
      ? await getMatchById(body.match_id) : null);
    if (!match) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Match not found', code: 'match_not_found' },
        { status: 404 }
      );
    }
    const isMatchParticipant = player.playerId === match.player_1_id || player.playerId === match.player_2_id;
    if (!isMatchParticipant && !player.isAdmin && !player.isCreator) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: 'Not authorized to create moments for this match',
          code: 'moment_create_forbidden',
        },
        { status: 403 }
      );
    }

    const values = {
      match_id: body.match_id,
      moment_type: body.moment_type,
      description: body.description ?? null,
      created_by: player.playerId,
    };
    const moment = nativeMatch
      ? await createPhaseMoment(values)
      : await createMoment({ ...values, timestamp_ms: body.timestamp_ms ?? null } as BroadcastMomentInsert);

    return NextResponse.json<ApiResult<BroadcastMoment>>({
      success: true,
      data: moment,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to save broadcast moment');
  }
}
