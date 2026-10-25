import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { authorizeMatchAdmin } from '@/lib/auth/match-admin';
import { previewMatchReset } from '@/lib/pkmn/game-pipeline';
import type { MatchResetPreview } from '@/lib/admin/match-detail';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** GET /api/admin/matches/[id]/reset-preview — what a reset of this match would touch (read-only). */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const access = await authorizeMatchAdmin(id);
    if (!access.ok) return access.response;

    const preview = await previewMatchReset(id);
    return NextResponse.json<ApiResult<MatchResetPreview>>({ success: true, data: preview });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to preview the match reset');
  }
}
