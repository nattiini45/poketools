import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin, requireAuth } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import {
  getPoolEntries,
  createPoolEntry,
  bulkCreatePoolEntries,
  deleteAllPoolEntries,
} from '@/lib/supabase/queries/draft-pool-entries';
import type { ApiResult } from '@/types/api';
import type { DraftPoolEntry } from '@/types/draft-pool';
import { draftPoolEntryCreateSchema, formatZodErrors } from '@/lib/validation';
import type { DraftPoolEntryCreateInput } from '@/lib/validation';

/**
 * GET /api/draft-pool-entries?season_id=X
 * List all pool entries for a season.
 */
export async function GET(request: NextRequest): Promise<NextResponse<ApiResult<DraftPoolEntry[]>>> {
  try {
    await requireAuth();
    const { searchParams } = new URL(request.url);
    const seasonId = searchParams.get('season_id');

    if (!seasonId) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'season_id is required', code: 'draft_season_id_required' },
        { status: 400 }
      );
    }

    const entries = await getPoolEntries(seasonId);
    return NextResponse.json({ success: true, data: entries });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch draft pool entries');
  }
}

/**
 * POST /api/draft-pool-entries
 * Create single or bulk pool entries. Admin only.
 * Body: DraftPoolEntryFormData | DraftPoolEntryFormData[]
 */
export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiResult<DraftPoolEntry | DraftPoolEntry[]>>> {
  try {
    const rawBody = await request.json();

    if (Array.isArray(rawBody)) {
      // Validate each entry individually
      const items: DraftPoolEntryCreateInput[] = [];
      for (const item of rawBody) {
        const zodResult = draftPoolEntryCreateSchema.safeParse(item);
        if (!zodResult.success) {
          const issues = formatZodErrors(zodResult.error);
          return NextResponse.json<ApiResult<never>>(
            { success: false, error: issues, code: 'validation_failed', params: { issues } },
            { status: 400 }
          );
        }
        items.push(zodResult.data);
      }
      if (items.length === 0) {
        return NextResponse.json<ApiResult<never>>(
          { success: false, error: 'At least one entry is required', code: 'pool_entries_empty' },
          { status: 400 }
        );
      }
      const seasonId = items[0].season_id;
      const hasMixedSeasonIds = items.some((item) => item.season_id !== seasonId);
      if (hasMixedSeasonIds) {
        return NextResponse.json<ApiResult<never>>(
          {
            success: false,
            error: 'All bulk entries must share the same season_id',
            code: 'pool_entries_mixed_season',
          },
          { status: 400 }
        );
      }

      await requireResourceAdmin('season', seasonId);
      const entries = await bulkCreatePoolEntries(items);
      return NextResponse.json({ success: true, data: entries }, { status: 201 });
    }

    const zodResult = draftPoolEntryCreateSchema.safeParse(rawBody);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }
    const input = zodResult.data;

    await requireResourceAdmin('season', input.season_id);
    const entry = await createPoolEntry(input);
    return NextResponse.json({ success: true, data: entry }, { status: 201 });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to create draft pool entry');
  }
}

/**
 * DELETE /api/draft-pool-entries?season_id=X
 * Clear all entries for a season (for reimport). Admin only.
 */
export async function DELETE(request: NextRequest): Promise<NextResponse<ApiResult<null>>> {
  try {
    const { searchParams } = new URL(request.url);
    const seasonId = searchParams.get('season_id');

    if (!seasonId) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'season_id is required', code: 'draft_season_id_required' },
        { status: 400 }
      );
    }

    await requireResourceAdmin('season', seasonId);
    await deleteAllPoolEntries(seasonId);
    return NextResponse.json({ success: true, data: null });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to delete draft pool entries');
  }
}
