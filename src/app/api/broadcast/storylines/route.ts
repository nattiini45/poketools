import { NextRequest, NextResponse } from 'next/server';
import { requireCreator } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { createStoryline, listStorylinesBySeason } from '@/lib/supabase/queries/storylines';
import { storylineInsertSchema, formatZodErrors } from '@/lib/validation';
import type { ApiResult } from '@/types/api';

export const dynamic = 'force-dynamic';

// Public: no auth required — storylines are broadcast content
export async function GET(req: NextRequest) {
  try {
    const seasonId = req.nextUrl.searchParams.get('season_id');
    if (!seasonId) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'season_id required', code: 'storyline_season_id_required' },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, data: await listStorylinesBySeason(seasonId) });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch storylines');
  }
}

export async function POST(req: NextRequest) {
  try {
    const player = await requireCreator();
    const rawBody = await req.json();
    const zodResult = storylineInsertSchema.safeParse(rawBody);

    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const storyline = await createStoryline({ ...zodResult.data, created_by: player.playerId });
    return NextResponse.json({ success: true, data: storyline }, { status: 201 });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to create storyline');
  }
}
