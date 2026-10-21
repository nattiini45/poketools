import { NextRequest, NextResponse } from 'next/server';
import { getThreatsForFormat } from '@/lib/pkmn/threat-list';
import { safeErrorResponse } from '@/lib/api/error-response';
import { formatZodErrors } from '@/lib/validation';
import { threatsQuerySchema } from '@/lib/pkmn/calc-request';
import { CALC_THREATS_RATE_LIMIT, gateCalcRateLimit, validationFailed } from '@/lib/pkmn/calc-route';
import type { ApiResult } from '@/types/api';
import type { ThreatEntry } from '@/types/calc';

// Public: no auth required
//
// Fully populated threat sets for a format. `limit` is a positive whole number
// (default 12, capped at 20); anything else is a 400, never a NaN reaching the usage query.
// Rate limited per client IP (`calc-threats` bucket).
export async function GET(request: NextRequest) {
  try {
    const limited = await gateCalcRateLimit(request, 'calc-threats', CALC_THREATS_RATE_LIMIT);
    if (limited) return limited;

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

    const parsed = threatsQuerySchema.safeParse({
      format,
      limit: searchParams.get('limit') ?? undefined,
      exclude: searchParams.get('exclude') ?? undefined,
    });
    if (!parsed.success) return validationFailed(formatZodErrors(parsed.error));

    const threats = await getThreatsForFormat(parsed.data.format, {
      limit: parsed.data.limit ?? 12,
      excludeSpecies: parsed.data.exclude ?? [],
    });

    return NextResponse.json<ApiResult<{ threats: ThreatEntry[] }>>({
      success: true,
      data: { threats },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch threats');
  }
}
