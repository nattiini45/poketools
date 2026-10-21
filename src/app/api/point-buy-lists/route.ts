import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import {
  getPointBuyListVersions,
  createListVersion,
} from '@/lib/supabase/queries/point-buy-lists';
import { logAuditEvent } from '@/lib/audit/log';
import type { ApiResult } from '@/types/api';
import type { PointBuyListVersion } from '@/types/point-buy';
import { pointBuyListCreateSchema } from '@/lib/validation/schemas';

/**
 * GET /api/point-buy-lists
 * List all point-buy list versions. Requires auth.
 */
export async function GET(): Promise<NextResponse<ApiResult<PointBuyListVersion[]>>> {
  try {
    await requireAuth();
    const lists = await getPointBuyListVersions();
    return NextResponse.json({ success: true, data: lists });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch point-buy lists');
  }
}

/**
 * POST /api/point-buy-lists
 * Create a new point-buy list version. Admin only.
 */
export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiResult<PointBuyListVersion>>> {
  try {
    const admin = await requireAdmin();

    const body = await request.json();
    const parsed = pointBuyListCreateSchema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => i.message).join(', ');
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: `Validation failed: ${issues}`, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const list = await createListVersion(parsed.data);

    logAuditEvent({
      actor_id: admin.playerId,
      actor_name: admin.name,
      action: 'point_buy_list.create',
      resource_type: 'point_buy_list_version',
      resource_id: list.id,
      resource_name: `${list.name} v${list.version}`,
    });

    return NextResponse.json({ success: true, data: list }, { status: 201 });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to create point-buy list');
  }
}
