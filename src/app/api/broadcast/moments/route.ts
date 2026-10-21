import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { isValidUuid } from '@/lib/utils/uuid';
import {
  getMomentsByMatch,
  createMoment,
} from '@/lib/supabase/queries/broadcast-moments';
import type { ApiResult } from '@/types/api';
import type { BroadcastMoment, BroadcastMomentInsert } from '@/types/broadcast';
import { broadcastMomentSchema, formatZodErrors } from '@/lib/validation';

/** GET /api/broadcast/moments?match_id=xxx */
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

    const moments = await getMomentsByMatch(matchId);
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
    const match = await getMatchById(body.match_id);
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

    const moment = await createMoment({
      match_id: body.match_id,
      moment_type: body.moment_type,
      description: body.description ?? null,
      timestamp_ms: body.timestamp_ms ?? null,
      created_by: player.playerId,
    } as BroadcastMomentInsert);

    return NextResponse.json<ApiResult<BroadcastMoment>>({
      success: true,
      data: moment,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to save broadcast moment');
  }
}
