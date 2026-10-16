import { NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { getTierLimits, upsertTierLimits } from '@/lib/supabase/queries/draft-tier-limits';
import { draftTierLimitsSchema, formatZodErrors } from '@/lib/validation';
import type { ApiResult } from '@/types/api';
import type { DraftTierLimitFormData } from '@/types/evolution';

/**
 * GET /api/draft-tier-limits?season_id=uuid
 * Returns all tier draft limits for a season.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const seasonId = searchParams.get('season_id');
  if (!seasonId) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: 'season_id is required', code: 'draft_season_id_required' },
      { status: 400 }
    );
  }

  try {
    const limits = await getTierLimits(seasonId);
    return NextResponse.json({ success: true, data: limits });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch tier limits');
  }
}

/**
 * POST /api/draft-tier-limits
 * Bulk upsert tier limits for a season. Replaces existing limits.
 * Body: { season_id: string, limits: { power_tier: string, max_picks: number }[] }
 */
export async function POST(request: Request) {
  try {
    const rawBody = await request.json();
    const zodResult = draftTierLimitsSchema.safeParse(rawBody);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }
    const body = zodResult.data;

    await requireResourceAdmin('season', body.season_id);

    const formData: DraftTierLimitFormData[] = body.limits.map((l) => ({
      season_id: body.season_id,
      power_tier: l.power_tier as DraftTierLimitFormData['power_tier'],
      max_picks: l.max_picks,
    }));

    const result = await upsertTierLimits(body.season_id, formData);
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to save tier limits');
  }
}
