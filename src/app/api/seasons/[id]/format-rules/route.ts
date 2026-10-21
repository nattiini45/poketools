import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer, requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { getFormatRules, upsertFormatRules } from '@/lib/supabase/queries/format-rules';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { assertEpbSeason } from '@/lib/season/format-utils';
import { logAuditEvent } from '@/lib/audit/log';
import { expireSeasonReads } from '@/lib/revalidation';
import type { ApiResult } from '@/types/api';
import type { FormatRules } from '@/types/format-rules';
import { formatRulesSchema } from '@/lib/validation/schemas';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/seasons/[id]/format-rules
 * Get format rules for a season. Requires auth.
 */
export async function GET(
  _request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResult<FormatRules | null>>> {
  try {
    await requirePlayer();
    const { id } = await params;
    const invalidId = rejectInvalidPathId(id, 'INVALID_SEASON_ID');
    if (invalidId) return invalidId;

    // Format gate: format rules exist only for Evolution Point Buy seasons
    const season = await getSeasonById(id);
    assertEpbSeason(season);

    const rules = await getFormatRules(id);
    return NextResponse.json({ success: true, data: rules });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch format rules');
  }
}

/**
 * PUT /api/seasons/[id]/format-rules
 * Create or update format rules for a season. Resource admin only.
 */
export async function PUT(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResult<FormatRules>>> {
  try {
    const { id } = await params;
    const admin = await requireResourceAdmin('season', id);
    const invalidId = rejectInvalidPathId(id, 'INVALID_SEASON_ID');
    if (invalidId) return invalidId;

    // Format gate: format rules exist only for Evolution Point Buy seasons
    const season = await getSeasonById(id);
    assertEpbSeason(season);

    const body = await request.json();
    const parsed = formatRulesSchema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => i.message).join(', ');
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: `Validation failed: ${issues}`, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const rules = await upsertFormatRules(id, parsed.data);
    expireSeasonReads(id);

    logAuditEvent({
      actor_id: admin.playerId,
      actor_name: admin.name,
      action: 'season.format_rules.update',
      resource_type: 'season',
      resource_id: id,
      metadata: { format_rules: parsed.data as unknown as Record<string, unknown> },
    });

    return NextResponse.json({ success: true, data: rules });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to update format rules');
  }
}
