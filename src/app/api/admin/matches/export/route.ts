import { NextRequest, NextResponse } from 'next/server';
import { requireAnyAdmin } from '@/lib/auth/helpers';
import { getAdminScope } from '@/lib/auth/admin-scope';
import { safeErrorResponse } from '@/lib/api/error-response';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import { logAuditEvent } from '@/lib/audit/log';
import {
  parseAdminMatchListSearch,
  resolveAdminMatchListRequest,
  validationFailedResponse,
} from '@/lib/admin/match-list-request';
import {
  ADMIN_MATCH_EXPORT_CAP,
  MATCH_EXPORT_BOM,
  matchExportFileName,
  matchesToCsv,
} from '@/lib/admin/match-export';
import { listAdminMatchesForExport } from '@/lib/supabase/queries/matches';
import type { AdminMatchRow } from '@/lib/supabase/queries/matches';

// Up to 5 id pages plus about 50 hydrate reads; the rate limit and the row cap bound the work.
export const maxDuration = 120;

/**
 * GET /api/admin/matches/export — the whole filtered set of the matches list as a CSV file.
 *
 * Takes the same strict query as `GET /api/admin/matches` (`page` and `page_size` are accepted and ignored), with
 * the same scope rules: a resource admin exports only the matches of their own leagues and tournaments, and a league
 * or phase outside that scope is a 403. At most `ADMIN_MATCH_EXPORT_CAP` rows; a larger set is cut and reported in
 * `X-Export-Count` / `X-Export-Total` / `X-Export-Truncated`. `X-Export-Search-Truncated` is set when the player
 * search matched more players than it expands. The file is UTF-8 with a byte order mark; cells that start like a
 * formula are quote-prefixed. Errors are JSON `ApiResult` bodies (the client tells them apart by content type).
 */
export async function GET(request: NextRequest) {
  try {
    const player = await requireAnyAdmin();
    const scope = await getAdminScope(player);

    const rate = await checkRateLimit('admin-match-export', player.playerId, { limit: 20, windowSeconds: 60 * 60 });
    if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);

    const parsed = parseAdminMatchListSearch(new URL(request.url).searchParams);
    if (!parsed.ok) return parsed.response;
    const query = parsed.query;

    const resolved = await resolveAdminMatchListRequest(scope, query);
    if (resolved.kind === 'invalid') return validationFailedResponse(resolved.issues);

    let rows: AdminMatchRow[] = [];
    let total = 0;
    let truncated = false;
    if (resolved.kind === 'ok') {
      ({ rows, total, truncated } = await listAdminMatchesForExport(resolved.filters, ADMIN_MATCH_EXPORT_CAP));
    }

    // The validated filters only; paging has no meaning for an export.
    const filters = Object.fromEntries(
      Object.entries(query).filter(([key, value]) => value !== undefined && key !== 'page' && key !== 'page_size')
    );
    logAuditEvent({
      actor_id: player.playerId,
      actor_name: player.name,
      action: 'admin.export',
      resource_type: 'matches',
      resource_id: null,
      metadata: { count: rows.length, total, truncated, filters },
    });

    const headers: Record<string, string> = {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${matchExportFileName(new Date(), { exported: rows.length, total })}"`,
      'Cache-Control': 'no-store',
      'X-Export-Count': String(rows.length),
      'X-Export-Total': String(total),
      'X-Export-Truncated': truncated ? 'true' : 'false',
    };
    if (resolved.searchTruncated) headers['X-Export-Search-Truncated'] = 'true';

    return new NextResponse(MATCH_EXPORT_BOM + matchesToCsv(rows), { headers });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to export matches');
  }
}
