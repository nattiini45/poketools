/**
 * Cron endpoint: refreshes meta usage stats (and current-gen sample sets)
 * from data.pkmn.cc. Smogon publishes new stats monthly; format discovery is
 * pattern-based, so newly published metas (e.g. a new VGC season) are picked
 * up automatically.
 *
 * Protected by CRON_SECRET — Vercel Cron invokes via GET with a Bearer token.
 * Scheduled monthly in vercel.json; also invocable manually.
 */

import { NextResponse } from 'next/server';
import { importAllStats } from '@/lib/smogon/import-stats';
import { importAllSets } from '@/lib/smogon/import-sets';
import { safeErrorResponse } from '@/lib/api/error-response';
import { expirePublicTags, publicTags } from '@/lib/revalidation';
import { secretsEqual } from '@/lib/utils/crypto';
import type { ApiResult } from '@/types/api';

export const maxDuration = 300;

export async function GET(request: Request) {
  // Validate CRON_SECRET from Authorization header
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error('[cron/refresh-usage-stats] CRON_SECRET not configured');
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: 'Cron not configured', code: 'cron_not_configured' },
      { status: 500 }
    );
  }

  if (
    !authHeader ||
    !authHeader.startsWith('Bearer ') ||
    !secretsEqual(authHeader.slice(7), cronSecret)
  ) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: 'Unauthorized', code: 'cron_unauthorized' },
      { status: 401 }
    );
  }

  try {
    const statsResults = await importAllStats();
    // /insights reads imported usage from the public read cache. A failed
    // format may still have written some chunks, so expire on every outcome.
    expirePublicTags([publicTags.metaUsage]);

    // Sample sets change rarely; refreshing the current gens is enough monthly
    const setsResults = await importAllSets([8, 9]);

    const ok = statsResults.filter((r) => r.status === 'success').length;
    const skipped = statsResults.filter((r) => r.status === 'skipped').length;
    const failed = statsResults.filter((r) => r.status === 'error');

    return NextResponse.json({
      success: true,
      data: {
        formats_imported: ok,
        formats_skipped: skipped,
        formats_failed: failed.map((r) => ({ format: r.format, error: r.error })),
        sets: setsResults.map((r) => ({
          generation: r.generation,
          sets: r.setsCount,
          status: r.status,
        })),
      },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to refresh usage stats');
  }
}
