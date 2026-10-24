import { NextResponse } from 'next/server';
import { requireAnyAdmin } from '@/lib/auth/helpers';
import { getAdminScope } from '@/lib/auth/admin-scope';
import { safeErrorResponse } from '@/lib/api/error-response';
import { listAdminMatchFilterOptions } from '@/lib/supabase/queries/matches';
import type { AdminMatchFilterOptions } from '@/lib/supabase/queries/matches';
import type { ApiResult } from '@/types/api';

/**
 * GET /api/admin/matches/filter-options — the leagues (with their phases) and
 * standalone tournaments the Matches page filters by. Archived ones are
 * included and flagged so old matches stay reachable. A site admin gets
 * everything; a resource admin only their own leagues and tournaments.
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
