import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import {
  getPointBuyListById,
  getListEntries,
  bulkCreateListEntries,
} from '@/lib/supabase/queries/point-buy-lists';
import { expirePublicTags, publicTags } from '@/lib/revalidation';
import type { ApiResult } from '@/types/api';
import type { PointBuyListEntry, PointBuyListEntryFormData } from '@/types/point-buy';
import { pointBuyBulkEntriesSchema } from '@/lib/validation/schemas';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/point-buy-lists/[id]/entries
 * Get all entries for a point-buy list version.
 */
export async function GET(
  _request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResult<PointBuyListEntry[]>>> {
  try {
    await requireAuth();
    const { id } = await params;

    const list = await getPointBuyListById(id);
    if (!list) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Point-buy list not found', code: 'point_buy_list_not_found' },
        { status: 404 }
      );
    }

    const entries = await getListEntries(id);
    return NextResponse.json({ success: true, data: entries });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch list entries');
  }
}

/**
 * POST /api/point-buy-lists/[id]/entries
 * Bulk import entries into a point-buy list version. Admin only.
 * Versions bound to a non-upcoming season are immutable snapshots — the
 * query layer (and a DB trigger as backstop) rejects such writes with 409.
 */
export async function POST(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResult<{ imported: number }>>> {
  try {
    await requireAdmin();
    const { id } = await params;

    const list = await getPointBuyListById(id);
    if (!list) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Point-buy list not found', code: 'point_buy_list_not_found' },
        { status: 404 }
      );
    }

    const body = await request.json();
    const parsed = pointBuyBulkEntriesSchema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: `Validation failed: ${issues}`, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const entries: PointBuyListEntryFormData[] = parsed.data.entries;
    const imported = await bulkCreateListEntries(id, entries);
    // The league matchup page reads this version's entries from the public read cache.
    expirePublicTags([publicTags.pointBuyList(id)]);

    return NextResponse.json({ success: true, data: { imported } }, { status: 201 });
  } catch (err) {
    // The DB immutability trigger (backstop for the query-layer guard)
    // raises P0001 when the version is bound to a non-upcoming season
    if (
      typeof err === 'object' && err !== null &&
      'code' in err && (err as { code?: unknown }).code === 'P0001'
    ) {
      console.error('List entry import rejected by immutability trigger', err);
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: 'This point-buy list version is bound to an active or completed season and cannot be modified. Create a new version instead.',
          code: 'list_version_immutable',
        },
        { status: 409 }
      );
    }
    return safeErrorResponse(err, 'Failed to import list entries');
  }
}
