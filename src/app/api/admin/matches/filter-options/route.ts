import { NextResponse } from 'next/server';
import { requireAnyAdmin } from '@/lib/auth/helpers';
import { getAdminScope } from '@/lib/auth/admin-scope';
import { safeErrorResponse } from '@/lib/api/error-response';
import { listAdminMatchFilterOptions } from '@/lib/supabase/queries/matches';
import type { AdminMatchFilterOptions } from '@/lib/supabase/queries/matches';
import type { ApiResult } from '@/types/api';

/**
 * GET /api/admin/matches/filter-options — the leagues (with their phases),
 * standalone tournaments and rulesets the Matches page filters by. Every
 * phase and standalone tournament carries its `ruleset_id`; `rulesets` lists
 * the rulesets of the tournaments in scope, by name. Archived leagues and
 * tournaments are included and flagged so old matches stay reachable. A site
 * admin gets everything; a resource admin only their own leagues,
 * tournaments and the rulesets those use.
 */
export async function GET() {
  try {
    const player = await requireAnyAdmin();
    const scope = await getAdminScope(player);

    const options = await listAdminMatchFilterOptions({
      tournamentIds: scope.tournamentIds,
      seasonIds: scope.seasonIds,
    });

    return NextResponse.json<ApiResult<AdminMatchFilterOptions>>({ success: true, data: options });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to load match filters');
  }
}
