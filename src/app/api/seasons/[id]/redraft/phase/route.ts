import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { getFormatRules, setRedraftPhaseOpen } from '@/lib/supabase/queries/format-rules';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getEpbPhaseStatus } from '@/lib/season/epb-phase';
import { assertEpbSeason } from '@/lib/season/format-utils';
import { redraftPhaseSchema } from '@/lib/validation/schemas';
import { expireDraftReads } from '@/lib/revalidation';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface RedraftPhaseStatus {
  open: boolean;
  hinrunde_complete: boolean;
}

/**
 * GET /api/seasons/[id]/redraft/phase
 * Redraft phase status for admins.
 */
export async function GET(
  _request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResult<RedraftPhaseStatus>>> {
  try {
    const { id } = await params;
    await requireResourceAdmin('season', id);

    const season = await getSeasonById(id);
    assertEpbSeason(season);

    const [rules, phase] = await Promise.all([
      getFormatRules(id),
      getEpbPhaseStatus(id),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        open: rules?.redraft_phase_open ?? false,
        hinrunde_complete: phase.hinrunde_complete,
      },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch redraft phase');
  }
}

/**
 * PATCH /api/seasons/[id]/redraft/phase
 * Open or close the redraft phase. Requires Hinrunde completion to open.
 */
export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResult<RedraftPhaseStatus>>> {
  try {
    const { id } = await params;
    await requireResourceAdmin('season', id);

    const season = await getSeasonById(id);
    assertEpbSeason(season);

    const body = await request.json();
    const parsed = redraftPhaseSchema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => i.message).join(', ');
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: `Validation failed: ${issues}`, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const phase = await getEpbPhaseStatus(id);
    if (parsed.data.open && !phase.hinrunde_complete) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Cannot open redraft until the Hinrunde (first half) is complete', code: 'redraft_hinrunde_incomplete' },
        { status: 400 }
      );
    }

    const rules = await setRedraftPhaseOpen(id, parsed.data.open);
    expireDraftReads(id);
    return NextResponse.json({
      success: true,
      data: {
        open: rules.redraft_phase_open,
        hinrunde_complete: phase.hinrunde_complete,
      },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to update redraft phase');
  }
}
