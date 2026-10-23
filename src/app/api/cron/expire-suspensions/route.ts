import { NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { clearExpiredSuspensions } from '@/lib/supabase/queries/players';
import { logAuditEvent } from '@/lib/audit/log';
import { timingSafeCompare } from '@/lib/utils/crypto';
import type { ApiResult } from '@/types/api';

interface ExpireSuspensionsResult {
  /** Players whose timed suspension had run out and who are active again. */
  lifted: number;
}

/**
 * Lifts timed suspensions whose `suspended_until` has passed.
 *
 * The suspend route stores `suspended_until`, but nothing reads it at request
 * time: the live auth guards only look at `status`. Without this job a timed
 * suspension would last until an admin reinstated the player by hand.
 * `suspended_until` is a moderation column and stays out of the session read.
 *
 * Audit trail: one `player.suspension_expired` event per player, written with
 * `actor_id: null` / `actor_name: 'System'`, like the `match.auto_confirm` cron.
 */
async function handle(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error('[cron/expire-suspensions] CRON_SECRET not configured');
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
    const lifted = await clearExpiredSuspensions(new Date().toISOString());

    for (const player of lifted) {
      logAuditEvent({
        actor_id: null,
        actor_name: 'System',
        action: 'player.suspension_expired',
        resource_type: 'player',
        resource_id: player.id,
        resource_name: player.name,
      });
    }

    return NextResponse.json<ApiResult<ExpireSuspensionsResult>>({
      success: true,
      data: { lifted: lifted.length },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to expire suspensions');
  }
}

// Vercel Cron invokes via GET; POST kept for manual/programmatic triggering
export const GET = handle;
export const POST = handle;
