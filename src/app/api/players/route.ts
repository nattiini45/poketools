import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { parsePagination } from '@/lib/api/pagination';
import { playerCreateSchema, formatZodErrors } from '@/lib/validation';
import { listPlayers, createPlayer } from '@/lib/supabase/queries/players';
import type { ApiResult } from '@/types/api';
import type { Player } from '@/types/player';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();

    const { limit, offset, search } = parsePagination(new URL(request.url).searchParams);

    const { data: players, total } = await listPlayers({ limit, offset, search });
    return NextResponse.json<ApiResult<Player[]>>({
      success: true,
      data: players,
      total,
    } as ApiResult<Player[]> & { total: number });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch players');
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
    const rawBody = await request.json();
    const zodResult = playerCreateSchema.safeParse(rawBody);

    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const player = await createPlayer(zodResult.data);
    return NextResponse.json<ApiResult<Player>>({ success: true, data: player }, { status: 201 });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to create player');
  }
}
