import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { wikiModerationNotesQuerySchema, formatZodErrors } from '@/lib/validation';
import { listNotesForModeration } from '@/lib/supabase/queries/wiki-notes';
import type { ApiResult } from '@/types/api';
import type { WikiNote } from '@/types/wiki';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();

    const query = Object.fromEntries(request.nextUrl.searchParams.entries());
    const zodResult = wikiModerationNotesQuerySchema.safeParse(query);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 },
      );
    }

    const notes = await listNotesForModeration(zodResult.data);
    return NextResponse.json<ApiResult<WikiNote[]>>({ success: true, data: notes });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to list wiki notes');
  }
}