import { NextRequest, NextResponse } from 'next/server';
import { getThreatsForFormat } from '@/lib/pkmn/threat-list';
import { safeErrorResponse } from '@/lib/api/error-response';
import type { ApiResult } from '@/types/api';
import type { ThreatEntry } from '@/types/calc';

// Public — returns fully populated threat sets for a format
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const format = searchParams.get('format');

  if (!format) {
    return NextResponse.json<ApiResult<never>>(
      {
        success: false,
        error: 'format query param is required',
        code: 'validation_failed',
        params: { issues: 'format query param is required' },
      },
      { status: 400 },
    );
  }

  const limit = Math.min(parseInt(searchParams.get('limit') ?? '12', 10), 20);
  const exclude = searchParams.get('exclude')?.split(',').filter(Boolean) ?? [];

  try {
    const threats = await getThreatsForFormat(format, {
      limit,
      excludeSpecies: exclude,
    });

    return NextResponse.json<ApiResult<{ threats: ThreatEntry[] }>>({
      success: true,
      data: { threats },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch threats');
  }
}
