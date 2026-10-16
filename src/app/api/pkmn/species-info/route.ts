import { NextRequest, NextResponse } from 'next/server';
import { getSpeciesInfoBatch } from '@/lib/pkmn/dex';
import { safeErrorResponse } from '@/lib/api/error-response';
import type { ApiResult } from '@/types/api';

// Public — batch endpoint returning types + base stats for multiple species
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const names = searchParams.get('names');

    if (!names) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: 'names parameter required (comma-separated)',
          code: 'validation_failed',
          params: { issues: 'names parameter required (comma-separated)' },
        },
        { status: 400 },
      );
    }

    const speciesList = names.split(',').map((n) => n.trim()).filter(Boolean);
    if (speciesList.length === 0 || speciesList.length > 12) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: 'Provide 1-12 species names',
          code: 'validation_failed',
          params: { issues: 'Provide 1-12 species names' },
        },
        { status: 400 },
      );
    }

    const results = getSpeciesInfoBatch(speciesList);

    return NextResponse.json<ApiResult<typeof results>>({ success: true, data: results });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch species info');
  }
}
