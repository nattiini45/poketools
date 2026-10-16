import { NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { callDraftRpc } from '@/lib/draft/rpc-errors';
import { draftTicksQuerySchema } from '@/lib/draft/schemas';
import { dispatchDraftNotifications, listTickablePools } from '@/lib/draft/notify';
import { expireDraftReads } from '@/lib/revalidation';
import { timingSafeCompare } from '@/lib/utils/crypto';
import { formatZodErrors } from '@/lib/validation';
import type { ApiResult } from '@/types/api';

/** Response of one cron run (draft-backend §8.1 #32). */
interface DraftTicksResult {
  /** Queue pools ticked. */
  pools: number;
  /** Overdue slots resolved (timeouts) across all pools. */
  timeouts: number;
  /** Redrafts published by this run (submission deadline passed). */
  published: number;
  /** Discord events handed to the webhooks (turn pings, reminders, admin alerts, redraft reveals). */
  notifications: number;
}

const DEFAULT_LIMIT = 25;

function tickCounts(raw: unknown): { timeouts: number; published: boolean } {
  if (typeof raw !== 'object' || raw === null) return { timeouts: 0, published: false };
  const r = raw as { timeouts?: unknown; published?: unknown };
  return {
    timeouts: typeof r.timeouts === 'number' && Number.isFinite(r.timeouts) ? r.timeouts : 0,
    published: r.published === true,
  };
}

/**
 * Draft ticker (draft-backend §11.2): resolves overdue pick clocks and passed
 * redraft submission deadlines in every open queue pool, then sends the
 * claimed Discord events (each exactly once, claim markers in SQL). Protected
 * like the other cron routes: `Authorization: Bearer $CRON_SECRET`.
 */
async function handle(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error('[cron/draft-ticks] CRON_SECRET not configured');
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: 'Cron not configured', code: 'cron_not_configured' },
      { status: 500 }
    );
  }

  if (!authHeader || !authHeader.startsWith('Bearer ') || !timingSafeCompare(authHeader.slice(7), cronSecret)) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: 'Unauthorized', code: 'cron_unauthorized' },
      { status: 401 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const parsed = draftTicksQuerySchema.safeParse({ limit: searchParams.get('limit') ?? undefined });
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }
    const pools = await listTickablePools(parsed.data.limit ?? DEFAULT_LIMIT);

    const result: DraftTicksResult = { pools: pools.length, timeouts: 0, published: 0, notifications: 0 };
    for (const pool of pools) {
      try {
        const tick = tickCounts(await callDraftRpc('draft_tick', { p_pool_id: pool.id }));
        result.timeouts += tick.timeouts;
        if (tick.published) {
          result.published += 1;
          // A publish deletes trackers shown on cached public pages (§6.6).
          expireDraftReads(pool.season_id);
        }
      } catch (err) {
        // One broken pool must not stall the others.
        console.error(`[cron/draft-ticks] tick failed for pool ${pool.id}:`, err);
      }
    }

    // Claims of every pool at once (also the events the pick routes' after() did not reach).
    const claims = await callDraftRpc('draft_claim_notifications', {});
    result.notifications = await dispatchDraftNotifications(claims);

    return NextResponse.json<ApiResult<DraftTicksResult>>({ success: true, data: result });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to tick drafts');
  }
}

// Vercel Cron invokes via GET; POST kept for manual/programmatic triggering
export const GET = handle;
export const POST = handle;
