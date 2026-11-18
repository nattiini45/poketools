import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { previewMatchReset } from '@/lib/pkmn/game-pipeline';
import type { MatchResetPreview } from '@/lib/admin/match-detail';
import type { ApiResult } from '@/types/api';
import { authorizeCorrectionTarget, nativeCorrectionServices } from '../reset/correction-target';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** GET /api/admin/matches/[id]/reset-preview — what a reset of this match would touch (read-only). */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const access = await authorizeCorrectionTarget(params);
    if (!access.ok) return access.response;

    const { target } = access;
    const preview = target.kind === 'phase'
      ? await (await nativeCorrectionServices(target.owner)).previewMatchReset(target.id)
      : await previewMatchReset(target.id);
    return NextResponse.json<ApiResult<MatchResetPreview>>({ success: true, data: preview });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to preview the match reset');
  }
}
