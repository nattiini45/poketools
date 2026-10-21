import { NextRequest, NextResponse } from 'next/server';
import { getTeamTypeAnalysis } from '@/lib/pkmn/dex';
import { safeErrorResponse } from '@/lib/api/error-response';
import { typeAnalysisSchema, formatZodErrors } from '@/lib/validation';
import type { TeamTypeAnalysis } from '@/lib/pkmn/dex';
import type { ApiResult } from '@/types/api';

/** POST /api/pkmn/type-analysis — Public: stateless type coverage computation, no DB writes. */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json();
    const zodResult = typeAnalysisSchema.safeParse(rawBody);

    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const analysis = getTeamTypeAnalysis(zodResult.data.species, zodResult.data.gen);

    return NextResponse.json<ApiResult<TeamTypeAnalysis>>({
      success: true,
      data: analysis,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to analyze types');
  }
}
