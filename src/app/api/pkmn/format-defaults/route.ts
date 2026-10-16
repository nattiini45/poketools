import { NextRequest, NextResponse } from 'next/server';
import { getFormatDefaults, FORMAT_DEFAULTS, type FormatDefaults } from '@/lib/pkmn/formats';
import { safeErrorResponse } from '@/lib/api/error-response';
import type { BaseFormat } from '@/types/ruleset';
import type { ApiResult } from '@/types/api';

// Public — returns default clauses + banlists for a base format
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format') as BaseFormat | null;

    if (!format || !(format in FORMAT_DEFAULTS)) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: 'Invalid format. Check /api/pkmn/formats for available options.',
          code: 'validation_failed',
          params: { issues: 'Invalid format. Check /api/pkmn/formats for available options.' },
        },
        { status: 400 }
      );
    }

    const defaults = getFormatDefaults(format);
    return NextResponse.json<ApiResult<FormatDefaults>>({ success: true, data: defaults });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch format defaults');
  }
}
