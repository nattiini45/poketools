import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { supabase } from '@/lib/supabase/client';
import { updatePoolEntry, deletePoolEntry } from '@/lib/supabase/queries/draft-pool-entries';
import type { ApiResult } from '@/types/api';
import type { DraftPoolEntry } from '@/types/draft-pool';
import { draftPoolEntryUpdateSchema, formatZodErrors } from '@/lib/validation';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** Helper to get entry and its season_id for auth check. */
async function getEntryWithSeason(id: string) {
  const { data, error } = await supabase
    .from('draft_pool_entries')
    .select('id, season_id')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * PATCH /api/draft-pool-entries/[id]
 * Update a pool entry's tier or cost. Admin only.
 */
export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResult<DraftPoolEntry>>> {
  try {
    const { id } = await params;
    const invalidId = rejectInvalidPathId(id, 'INVALID_POOL_ENTRY_ID');
    if (invalidId) return invalidId;
    const entry = await getEntryWithSeason(id);
    if (!entry) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Pool entry not found', code: 'pool_entry_not_found' },
        { status: 404 }
      );
    }

    await requireResourceAdmin('season', entry.season_id);
    const rawBody = await request.json();
    const zodResult = draftPoolEntryUpdateSchema.safeParse(rawBody);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }
    const body = zodResult.data;

    if (Object.keys(body).length === 0) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'No valid fields to update', code: 'draft_update_empty' },
        { status: 400 }
      );
    }

    const updated = await updatePoolEntry(id, body);
    return NextResponse.json({ success: true, data: updated });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to update draft pool entry');
  }
}

/**
 * DELETE /api/draft-pool-entries/[id]
 * Remove a single entry from the pool. Admin only.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResult<null>>> {
  try {
    const { id } = await params;
    const invalidId = rejectInvalidPathId(id, 'INVALID_POOL_ENTRY_ID');
    if (invalidId) return invalidId;
    const entry = await getEntryWithSeason(id);
    if (!entry) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Pool entry not found', code: 'pool_entry_not_found' },
        { status: 404 }
      );
    }

    await requireResourceAdmin('season', entry.season_id);
    await deletePoolEntry(id);
    return NextResponse.json({ success: true, data: null });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to delete draft pool entry');
  }
}
