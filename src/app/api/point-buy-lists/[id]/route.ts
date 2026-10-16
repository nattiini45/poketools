import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import {
  getPointBuyListById,
  deactivateListVersion,
} from '@/lib/supabase/queries/point-buy-lists';
import { logAuditEvent } from '@/lib/audit/log';
import type { ApiResult } from '@/types/api';
import type { PointBuyListVersion } from '@/types/point-buy';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/point-buy-lists/[id]
 * Get a single point-buy list version with metadata.
 */
export async function GET(
  _request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResult<PointBuyListVersion>>> {
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

    return NextResponse.json({ success: true, data: list });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch point-buy list');
  }
}

/**
 * PATCH /api/point-buy-lists/[id]
 * Deactivate a point-buy list version. Admin only.
 */
export async function PATCH(
  _request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResult<null>>> {
  try {
    const admin = await requireAdmin();
    const { id } = await params;

    const list = await getPointBuyListById(id);
    if (!list) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Point-buy list not found', code: 'point_buy_list_not_found' },
        { status: 404 }
      );
    }

    await deactivateListVersion(id);

    logAuditEvent({
      actor_id: admin.playerId,
      actor_name: admin.name,
      action: 'point_buy_list.deactivate',
      resource_type: 'point_buy_list_version',
      resource_id: id,
      resource_name: `${list.name} v${list.version}`,
    });

    return NextResponse.json({ success: true, data: null });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to update point-buy list');
  }
}
