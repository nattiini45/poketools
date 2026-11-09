/**
 * Cron endpoint: the format engine's time pass. Fires the calendar marks that are due and applies the deadline policies
 * of the running kit leagues (forfeit, admin review, action lock, seeded random pick), then expires open challenges.
 *
 * Protected by CRON_SECRET (Vercel Cron sends it as a Bearer token); runs every 15 minutes (the vercel.json schedule).
 * Every step is idempotent (`runFormatCronPass`), so an overlapping or repeated run applies nothing twice. A league that
 * fails is logged and counted without stopping the others; the run answers 5xx when any failed, so function-error
 * alerting sees it.
 */
import { NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { runFormatCronPass, type FormatCronSummary } from '@/lib/format-engine/runtime/cron';
import { logger } from '@/lib/logger';
import { secretsEqual } from '@/lib/utils/crypto';
import type { ApiResult } from '@/types/api';

export const maxDuration = 300;

async function handle(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    logger.error('cron/format-engine', 'CRON_SECRET not configured');
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
    const summary = await runFormatCronPass();
    if (summary.failures > 0) {
      logger.error('cron/format-engine', 'run finished with failures', { summary });
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: `Format engine cron run finished with ${summary.failures} failure${summary.failures === 1 ? '' : 's'}.`,
          code: 'format_cron_partial_failure',
          params: { count: summary.failures },
          details: JSON.stringify(summary),
        },
        { status: 500 }
      );
    }
    return NextResponse.json<ApiResult<FormatCronSummary>>({ success: true, data: summary });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to run the format engine cron pass');
  }
}

// Vercel Cron invokes via GET; POST kept for manual/programmatic triggering
export const GET = handle;
export const POST = handle;
