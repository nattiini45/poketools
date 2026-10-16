import { NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { finalizeMatchCompletion } from '@/lib/match/finalize';
import { listMatchesReadyForAutoConfirm, updateMatchStatus } from '@/lib/supabase/queries/matches';
import { logAuditEvent } from '@/lib/audit/log';
import { timingSafeCompare } from '@/lib/utils/crypto';
import type { ApiResult } from '@/types/api';

interface AutoConfirmResult {
  checked: number;
  completed: number;
  skipped_no_winner: number;
}

async function handle(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error('[cron/auto-confirm] CRON_SECRET not configured');
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
    const rawLimit = Number.parseInt(searchParams.get('limit') ?? '25', 10);
    const limit = Number.isNaN(rawLimit) ? 25 : Math.min(Math.max(rawLimit, 1), 100);
    const matches = await listMatchesReadyForAutoConfirm(new Date().toISOString(), limit);

    const result: AutoConfirmResult = {
      checked: matches.length,
      completed: 0,
      skipped_no_winner: 0,
    };

    for (const match of matches) {
      if (!match.winner_id) {
        result.skipped_no_winner += 1;
        continue;
      }

      await updateMatchStatus(
        match.id,
        'completed',
        match.winner_id,
        undefined,
        match.notes ? `${match.notes}\nAuto-confirmed after timeout.` : 'Auto-confirmed after timeout.'
      );
      await finalizeMatchCompletion({
        match,
        winnerId: match.winner_id,
        previousStatus: match.status,
      });

      logAuditEvent({
        actor_id: null,
        actor_name: 'System',
        action: 'match.auto_confirm',
        resource_type: 'match',
        resource_id: match.id,
        resource_name: `${match.player_1_name} vs ${match.player_2_name}`,
        metadata: {
          auto_confirm_at: match.auto_confirm_at,
          winner_id: match.winner_id,
        },
      });

      result.completed += 1;
    }

    return NextResponse.json<ApiResult<AutoConfirmResult>>({ success: true, data: result });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to auto-confirm matches');
  }
}

// Vercel Cron invokes via GET; POST kept for manual/programmatic triggering
export const GET = handle;
export const POST = handle;