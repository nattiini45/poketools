/**
 * Cron endpoint: processes pending aggregate jobs.
 *
 * Protected by CRON_SECRET — Vercel Cron sends this as a Bearer token.
 * Runs every 10 minutes (the vercel.json cron schedule, D37) as the safety net
 * for any jobs not processed via `after()`.
 *
 * Answers 5xx whenever the queue cannot move, so function-error alerting sees
 * it (code review H6/M2): a failed claim (`aggregate_claim_failed`), any other
 * failure of the run itself, e.g. the reclaim, a queue write or the
 * revalidation after the batch (`aggregate_queue_failed`), a failed health
 * probe (`aggregate_health_failed`), and jobs that can never drain on their
 * own (`aggregate_jobs_stranded`). A job that merely failed this run is
 * retried later: counted in `failed`, still 200.
 *
 * Jobs that ENDED `failed` (attempts exhausted) do not turn the run into a 5xx
 * (lead ruling CR-3): the body reports their total as `failedJobs`, a non-zero
 * total is logged at error level every run, and admins review them in the
 * aggregate stats (docs/match.md).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  AggregateQueueClaimError,
  countFailedAggregateJobs,
  getAggregateJobHealth,
  processAggregateJobs,
  type AggregateJobHealth,
  type ProcessAggregateJobsResult,
} from '@/lib/match/aggregate-queue';
import { safeErrorResponse } from '@/lib/api/error-response';
import { timingSafeCompare } from '@/lib/utils/crypto';
import { formatZodErrors } from '@/lib/validation';
import type { ApiResult } from '@/types/api';

/**
 * Below the 5-minute reclaim window of `reclaim_stale_aggregate_jobs`, so a
 * live run is never reclaimed mid-batch. (A reclaimed job still cannot count
 * twice: `apply_aggregate_job` fences on the job and the game marker.)
 */
export const maxDuration = 120;

const DEFAULT_LIMIT = 20;

export interface ProcessAggregatesCronResult extends ProcessAggregateJobsResult {
  /** Jobs that ended `failed` (attempts exhausted), all time; their games are not counted. */
  failedJobs: number;
}

const processAggregatesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

async function handle(request: Request) {
  // Validate CRON_SECRET from Authorization header
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error('[cron/process-aggregates] CRON_SECRET not configured');
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
    const parsed = processAggregatesQuerySchema.safeParse({ limit: searchParams.get('limit') ?? undefined });
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    let result: ProcessAggregateJobsResult;
    try {
      result = await processAggregateJobs(parsed.data.limit ?? DEFAULT_LIMIT);
    } catch (err) {
      // One code per failure cause, so the response tells them apart as well
      // as the server log does: the claim, or anything else in the run (the
      // reclaim, a queue write, the revalidation after the batch).
      if (err instanceof AggregateQueueClaimError) {
        return safeErrorResponse(err, 'Failed to claim aggregate jobs', 500, 'aggregate_claim_failed');
      }
      return safeErrorResponse(err, 'Failed to process aggregate jobs', 500, 'aggregate_queue_failed');
    }

    let health: AggregateJobHealth;
    let failedJobs: number;
    try {
      [health, failedJobs] = await Promise.all([getAggregateJobHealth(), countFailedAggregateJobs()]);
    } catch (err) {
      return safeErrorResponse(err, 'Failed to check aggregate job health', 500, 'aggregate_health_failed');
    }

    if (health.strandedPending > 0 || health.staleProcessing > 0) {
      console.error('[cron/process-aggregates] Aggregate jobs cannot drain:', { ...health, failedJobs, run: result });
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error:
            `Aggregate jobs are stranded (${health.strandedPending} unclaimable, ` +
            `${health.staleProcessing} stuck processing)`,
          code: 'aggregate_jobs_stranded',
          params: { stranded: health.strandedPending, stale: health.staleProcessing },
        },
        { status: 500 }
      );
    }

    if (failedJobs > 0) {
      // Not a failed run (ruling CR-3): these games stay uncounted until an
      // admin re-queues them or rebuilds the scope.
      console.error(
        `[cron/process-aggregates] ${failedJobs} aggregate job(s) ended failed (attempts exhausted); ` +
          'their games are not counted until an admin rebuilds the affected scopes'
      );
    }

    return NextResponse.json<ApiResult<ProcessAggregatesCronResult>>({
      success: true,
      data: { ...result, failedJobs },
    });
  } catch (err) {
    // Only the request parsing above can land here.
    return safeErrorResponse(err, 'Failed to process aggregate jobs', 500, 'aggregate_queue_failed');
  }
}

// Vercel Cron invokes via GET; POST kept for manual/programmatic triggering
export const GET = handle;
export const POST = handle;
