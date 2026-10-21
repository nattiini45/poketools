import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { importFormatStats } from '@/lib/smogon/import-stats';
import { expirePublicTags, publicTags } from '@/lib/revalidation';
import type { ApiResult } from '@/types/api';
import { adminImportStatsSchema, formatZodErrors } from '@/lib/validation';

/** POST /api/admin/import-stats — admin-only Smogon usage stats import */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
    const rawBody = await request.json();
    const zodResult = adminImportStatsSchema.safeParse(rawBody);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const result = await importFormatStats(zodResult.data.format);
    // /insights reads imported usage from the public read cache. A failed
    // format may still have written some chunks, so expire on every outcome.
    expirePublicTags([publicTags.metaUsage]);
    return NextResponse.json<ApiResult<typeof result>>({ success: true, data: result });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to import stats');
  }
}
