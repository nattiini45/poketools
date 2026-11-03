import { NextResponse } from 'next/server';
import { requireAnyAdmin } from '@/lib/auth/helpers';
import { getAdminScope } from '@/lib/auth/admin-scope';
import { safeErrorResponse } from '@/lib/api/error-response';
import {
  countMatches,
  countSiteTotals,
  listActiveCompetitions,
  loadAttention,
  loadRecentActivity,
} from '@/lib/supabase/queries/admin-dashboard';
import type { DashboardData } from '@/lib/admin/dashboard';
import type { ApiResult } from '@/types/api';
import type { MatchStatus } from '@/types/match';

export type { AttentionMatch, AuditLogEntry, DashboardCounts, DashboardData } from '@/lib/admin/dashboard';

const ACTIVE_STATUSES: MatchStatus[] = ['scheduled', 'in_progress', 'pending_confirmation'];

/**
 * GET /api/admin/dashboard — the landing dashboard of /admin.
 *
 * Counts and the attention list cover live competitions only: test leagues
 * and archived leagues and tournaments are left out, and the site-wide player
 * total skips test accounts. The list is the 20 matches that have waited
 * longest, with exact per-status totals.
 *
 * A site admin gets the site-wide totals and the audit trail. A resource
 * admin gets the tournament, league, active-match and attention figures of
 * their own scope only; the site-wide player and game totals and the audit
 * trail are `null` (not available for the role). A resource admin whose
 * assignments were all removed gets zeros and an empty list, not an error.
 */
export async function GET() {
  try {
    const player = await requireAnyAdmin();
    const scope = await getAdminScope(player);

    const active = await listActiveCompetitions({
      seasonIds: scope.seasonIds,
      tournamentIds: scope.tournamentIds,
    });

    const [activeMatches, attention] = await Promise.all([
      countMatches(ACTIVE_STATUSES, active.tournamentIds),
      loadAttention(active.tournamentIds),
    ]);

    const counts = {
      tournaments: active.standaloneTournamentIds.length,
      active_matches: activeMatches,
      leagues: active.seasonIds.length,
    };
    const attentionData = {
      attention_required: attention.rows,
      attention_total: attention.total,
      attention_by_status: attention.byStatus,
    };

    if (scope.isSiteAdmin) {
      const [totals, recentActivity] = await Promise.all([countSiteTotals(), loadRecentActivity()]);

      return NextResponse.json<ApiResult<DashboardData>>({
        success: true,
        data: {
          counts: { players: totals.players, ...counts, games: totals.games },
          ...attentionData,
          recent_activity: recentActivity,
        },
      });
    }

    return NextResponse.json<ApiResult<DashboardData>>({
      success: true,
      data: {
        counts: { players: null, ...counts, games: null },
        ...attentionData,
        recent_activity: null,
      },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to load dashboard');
  }
}
