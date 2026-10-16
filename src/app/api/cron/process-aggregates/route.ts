/**
 * Cron endpoint: processes pending aggregate jobs.
 *
 * Protected by CRON_SECRET — Vercel Cron sends this as a Bearer token.
 * Runs every 10 minutes (the vercel.json cron schedule, D37) as the safety net
 * for any jobs not processed via `after()`.
 */

import { NextResponse } from 'next/server';
import { processAggregateJobs } from '@/lib/match/aggregate-queue';
import { safeErrorResponse } from '@/lib/api/error-response';
import { timingSafeCompare } from '@/lib/utils/crypto';
import type { ApiResult } from '@/types/api';

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
    const rawLimit = parseInt(searchParams.get('limit') ?? '20', 10);
    const limit = Math.min(Math.max(isNaN(rawLimit) ? 20 : rawLimit, 1), 100);
    const result = await processAggregateJobs(limit);

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to process aggregate jobs');
  }
}

// Vercel Cron invokes via GET; POST kept for manual/programmatic triggering
export const GET = handle;
export const POST = handle;