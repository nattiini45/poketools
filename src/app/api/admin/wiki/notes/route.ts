import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { wikiModerationNotesQuerySchema, formatZodErrors } from '@/lib/validation';
import { readGlobalWikiNoteQueue } from '@/lib/supabase/queries/wiki-moderation-queues';
import { CACHE } from '@/lib/api/cache';
import type { ApiResult } from '@/types/api';

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

    const { notes, mixed } = await readGlobalWikiNoteQueue(zodResult.data);
    return NextResponse.json<ApiResult<typeof notes>>({ success: true, data: notes },
      mixed ? { headers: CACHE.NONE } : undefined);
  } catch (err) {
    return safeErrorResponse(err, 'Failed to list wiki notes');
  }
}
