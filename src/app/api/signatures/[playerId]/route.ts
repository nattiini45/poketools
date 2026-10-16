import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { getPlayerSignatures } from '@/lib/supabase/queries/signatures';
import type { ApiResult } from '@/types/api';
import type { PlayerSignatures } from '@/types/signature';

interface RouteParams {
  params: Promise<{ playerId: string }>;
}

// Public: no auth required
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { playerId } = await params;
    const signatures = await getPlayerSignatures(playerId);

    return NextResponse.json<ApiResult<PlayerSignatures | null>>({
      success: true,
      data: signatures,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch player signatures');
  }
}
