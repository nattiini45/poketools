import { NextRequest, NextResponse } from 'next/server';
import { requireCreator } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { castSessionCreateSchema, formatZodErrors } from '@/lib/validation';
import {
  listCastSessions,
  createCastSession,
} from '@/lib/supabase/queries/cast-sessions';
import { SOLO_PLAYER2_DEFAULT_NAME } from '@/lib/broadcast/solo-defaults';
import type { ApiResult } from '@/types/api';
import type { CastSession, CastSessionInsert } from '@/types/cast-session';

/** GET /api/cast-sessions — list current user's cast sessions */
export async function GET() {
  try {
    const player = await requireCreator();
    const sessions = await listCastSessions(player.playerId);
    return NextResponse.json<ApiResult<CastSession[]>>({
      success: true,
      data: sessions,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to list cast sessions');
  }
}

/** POST /api/cast-sessions — create a new cast session */
export async function POST(request: NextRequest) {
  try {
    const player = await requireCreator();
    const rawBody = await request.json();
    const zodResult = castSessionCreateSchema.safeParse(rawBody);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }
    const body = zodResult.data as CastSessionInsert;
    const input: CastSessionInsert = body.mode === 'solo'
      ? {
          ...body,
          player1_id: body.player1_id ?? player.playerId,
          player1_name: body.player1_name ?? player.name,
          player1_avatar_url: body.player1_avatar_url ?? player.avatarUrl,
          player2_id: body.player2_id ?? null,
          player2_name: body.player2_name ?? SOLO_PLAYER2_DEFAULT_NAME,
          player2_avatar_url: body.player2_avatar_url ?? null,
        }
      : body;

    const session = await createCastSession(player.playerId, input);

    return NextResponse.json<ApiResult<CastSession>>(
      { success: true, data: session },
      { status: 201 }
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to create cast session');
  }
}
