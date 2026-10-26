/**
 * Cron endpoint: removes the leagues whose time in the trash ran out.
 *
 * Protected by CRON_SECRET (Vercel Cron sends it as a Bearer token); runs daily (the vercel.json schedule).
 *
 * A league moved to the trash (`DELETE /api/seasons/[id]`) stays restorable until its `purge_after`. This job calls
 * `league_trash_expire`, which deletes the due entries (oldest first, at most `limit` per run, entries whose rebuild
 * after the delete is still unconfirmed are skipped) and returns the league's match ids. A restore refuses an entry
 * whose `purge_after` has passed even before this job removed it, and the database serialises a restore and an expiry
 * on the same entry, so exactly one of them wins.
 *
 * The database delete is irreversible, so its audit trail comes first: one `season.purge` event per removed league,
 * written with `actor_id: null` / `actor_name: 'System'` like the other crons, before any storage work. Then the
 * social-image objects of those matches are swept (`social-image-sweep.ts`, decision D6). A sweep failure is logged
 * with its own code and reported in the body but never undoes the expiry; an object the sweep misses stays in the
 * bucket.
 *
 * Answers 5xx when the expiry itself fails, so function-error alerting sees it. Idempotent: a run with nothing due
 * answers 200.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { safeErrorResponse } from '@/lib/api/error-response';
import { logAuditEvent } from '@/lib/audit/log';
import { LEAGUE_TRASH_EXPIRE_BATCH, LEAGUE_TRASH_SWEEP_BUDGET_MS } from '@/lib/league-trash/constants';
import { sweepLeagueSocialImages, type SocialImageSweepResult } from '@/lib/league-trash/social-image-sweep';
import { expireLeagueTrash } from '@/lib/supabase/queries/league-trash';
import { secretsEqual } from '@/lib/utils/crypto';
import { formatZodErrors } from '@/lib/validation';
import type { ApiResult } from '@/types/api';

export const maxDuration = 120;

export interface ExpireLeagueTrashCronResult {
  /** Leagues removed from the trash for good in this run. */
  expired: number;
  /** Per removed league: the trash entry and what the storage sweep did. */
  leagues: { trash_id: string; season_id: string; social_images: SocialImageSweepResult }[];
}

const expireQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

async function handle(request: Request) {
  // Validate CRON_SECRET from Authorization header
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error('[cron/expire-league-trash] CRON_SECRET not configured');
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: 'Cron not configured', code: 'cron_not_configured' },
      { status: 500 }
    );
  }

  if (!authHeader || !authHeader.startsWith('Bearer ') || !secretsEqual(authHeader.slice(7), cronSecret)) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: 'Unauthorized', code: 'cron_unauthorized' },
      { status: 401 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const parsed = expireQuerySchema.safeParse({ limit: searchParams.get('limit') ?? undefined });
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const expired = await expireLeagueTrash(new Date(), parsed.data.limit ?? LEAGUE_TRASH_EXPIRE_BATCH);

    for (const row of expired) {
      logAuditEvent({
        actor_id: null,
        actor_name: 'System',
        action: 'season.purge',
        resource_type: 'season',
        resource_id: row.season_id,
        resource_name: row.season_name,
        metadata: {
          trash_id: row.id,
          deleted_at: row.deleted_at,
          purge_after: row.purge_after,
          matches: row.match_ids.length,
        },
      });
    }

    const sweepDeadline = Date.now() + LEAGUE_TRASH_SWEEP_BUDGET_MS;
    const leagues: ExpireLeagueTrashCronResult['leagues'] = [];
    for (const row of expired) {
      const socialImages = await sweepLeagueSocialImages(row.match_ids, sweepDeadline);
      leagues.push({ trash_id: row.id, season_id: row.season_id, social_images: socialImages });
    }

    return NextResponse.json<ApiResult<ExpireLeagueTrashCronResult>>({
      success: true,
      data: { expired: expired.length, leagues },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to expire the league trash', 500);
  }
}

// Vercel Cron invokes via GET; POST kept for manual/programmatic triggering
export const GET = handle;
export const POST = handle;
