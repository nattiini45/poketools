import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { importGenerationSets } from '@/lib/smogon/import-sets';
import type { ApiResult } from '@/types/api';
import { adminImportSetsSchema, formatZodErrors } from '@/lib/validation';

/** POST /api/admin/import-sets — admin-only Smogon sample sets import */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
    const rawBody = await request.json();
    const zodResult = adminImportSetsSchema.safeParse(rawBody);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const result = await importGenerationSets(zodResult.data.generation);
    return NextResponse.json<ApiResult<typeof result>>({ success: true, data: result });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to import sets');
  }
}
