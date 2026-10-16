import { NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { getAvailableFormats, getLastImportDate } from '@/lib/supabase/queries/meta-usage';
import type { ApiResult } from '@/types/api';

// Public — list available formats in the usage cache
export async function GET() {
  try {
    const [formats, lastImported] = await Promise.all([
      getAvailableFormats(),
      getLastImportDate(),
    ]);

    return NextResponse.json<ApiResult<{ formats: string[]; last_imported: string | null }>>({
      success: true,
      data: {
        formats,
        last_imported: lastImported?.toISOString() ?? null,
      },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch formats');
  }
}
