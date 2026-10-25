import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { epbPack } from '@/lib/format-pack';
import { buildFormatDriftReport, type FormatDriftReport } from '@/lib/admin/format-drift';
import { listFormatRulesOrders, listLeaguePhasesForDrift } from '@/lib/supabase/queries/format-drift';
import type { ApiResult } from '@/types/api';

/**
 * GET /api/admin/format-drift — read-only report of where stored league settings differ from the format pack or
 * from what the engine reads (tiebreaker order vs the format pack default, information only because the standings
 * use the stored order; advancement rule on the source vs the target phase).
 * Site admins only: it spans every league. Reads names, ids and rules; writes nothing and logs no audit event.
 */
export async function GET() {
  try {
    await requireAdmin();

    const [formatRules, phases] = await Promise.all([listFormatRulesOrders(), listLeaguePhasesForDrift()]);
    const report = buildFormatDriftReport({
      formatRules: formatRules.rows,
      phases: phases.rows,
      packChain: epbPack.tiebreakerChain,
      generatedAt: new Date().toISOString(),
      truncated: { formatRules: formatRules.truncated, phases: phases.truncated },
    });

    return NextResponse.json<ApiResult<FormatDriftReport>>({ success: true, data: report });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to build the format drift report');
  }
}
