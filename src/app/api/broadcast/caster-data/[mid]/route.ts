import { NextRequest, NextResponse } from 'next/server';
import { requireCreator } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { fetchCasterData } from '@/lib/broadcast/caster-data';
import type { ApiResult } from '@/types/api';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ mid: string }> }
) {
  try {
    await requireCreator();
    const { mid } = await params;

    const data = await fetchCasterData(mid);
    if (!data) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Match not found', code: 'match_not_found' },
        { status: 404 }
      );
    }

    return NextResponse.json(data, {
      headers: { 'Cache-Control': 's-maxage=30, stale-while-revalidate=60' },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch caster data');
  }
}
