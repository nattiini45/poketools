import { NextRequest, NextResponse } from 'next/server';
import { getBaseStats } from '@/lib/pkmn/dex';
import { safeErrorResponse } from '@/lib/api/error-response';
import type { ApiResult } from '@/types/api';

// Public — returns base stats + types for a single species
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const species = searchParams.get('species');

    if (!species) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: 'species parameter required',
          code: 'validation_failed',
          params: { issues: 'species parameter required' },
        },
        { status: 400 },
      );
    }

    const info = getBaseStats(species);
    if (!info) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: `Unknown species: ${species}`, code: 'unknown_species', params: { pokemon: String(species) } },
        { status: 404 },
      );
    }

    return NextResponse.json<ApiResult<typeof info>>({ success: true, data: info });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch base stats');
  }
}
