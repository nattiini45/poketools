import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { authorizeMatchAdmin } from '@/lib/auth/match-admin';
import { formatZodErrors, matchScheduleSchema } from '@/lib/validation';
import { cancelPendingMatchProposalsForMatch } from '@/lib/supabase/queries/match-proposals';
import { updateOpenMatchSchedule } from '@/lib/supabase/queries/matches';
import { revalidateMatchPages } from '@/lib/revalidation';
import { logAuditEvent } from '@/lib/audit/log';
import type { ScheduleResult } from '@/lib/admin/match-detail';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string }>;
}

function scheduleCompleted() {
  return NextResponse.json<ApiResult<never>>(
    {
      success: false,
      error: 'A completed match cannot be rescheduled. Reopen it first.',
      code: 'match_schedule_completed',
    },
    { status: 409 }
  );
}

/** Same instant, whatever the offset spelling; two unset times are equal. */
function sameInstant(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return Date.parse(a) === Date.parse(b);
}

/**
 * PATCH /api/admin/matches/[id]/schedule — set, change or clear the battle
 * time of a match that is not completed. Pending time proposals are cancelled
 * so a stale proposal cannot reschedule the match later; if that cancel fails
 * the time stays saved, the audit event and revalidation still run, and the
 * answer carries `proposals_cancel_failed`.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const access = await authorizeMatchAdmin(id);
    if (!access.ok) return access.response;
    const { player, match } = access;

    let rawBody: unknown = null;
    try {
      rawBody = await request.json();
    } catch {
      rawBody = null;
    }
    const parsed = matchScheduleSchema.safeParse(rawBody);
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }
    const scheduledAt = parsed.data.scheduled_at;

    if (match.status === 'completed') return scheduleCompleted();

    if (sameInstant(match.scheduled_at, scheduledAt)) {
      return NextResponse.json<ApiResult<ScheduleResult>>({
        success: true,
        data: {
          scheduled_at: match.scheduled_at,
          previous_scheduled_at: match.scheduled_at,
          proposals_cancelled: 0,
          proposals_cancel_failed: false,
          unchanged: true,
        },
      });
    }

    // Guarded write: null means the match completed (or vanished) since the read above.
    const updated = await updateOpenMatchSchedule(id, scheduledAt);
    if (!updated) return scheduleCompleted();

    // The time is committed. A failed proposal cancel must not skip the audit event or the
    // revalidation below: it is reported instead, and the admin cancels the proposals by hand.
    let proposalsCancelled = 0;
    let proposalsCancelFailed = false;
    try {
      proposalsCancelled = (await cancelPendingMatchProposalsForMatch(id)).length;
    } catch (err) {
      proposalsCancelFailed = true;
      console.error(`[admin schedule] match ${id}: the time was saved but cancelling its pending proposals failed:`, err);
    }

    logAuditEvent({
      actor_id: player.playerId,
      actor_name: player.name,
      action: 'match.schedule',
      resource_type: 'match',
      resource_id: id,
      resource_name: `${match.player_1_name} vs ${match.player_2_name}`,
      changes: {
        scheduled_at: { before: match.scheduled_at, after: updated.scheduled_at },
      },
      metadata: {
        tournament_id: match.tournament_id,
        proposals_cancelled: proposalsCancelled,
        proposals_cancel_failed: proposalsCancelFailed,
      },
    });

    try {
      await revalidateMatchPages(match.tournament_id, id);
    } catch (err) {
      console.error(`[admin schedule] match ${id}: the time was saved but the page revalidation failed:`, err);
    }

    return NextResponse.json<ApiResult<ScheduleResult>>({
      success: true,
      data: {
        scheduled_at: updated.scheduled_at,
        previous_scheduled_at: match.scheduled_at,
        proposals_cancelled: proposalsCancelled,
        proposals_cancel_failed: proposalsCancelFailed,
        unchanged: false,
      },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to update the match schedule');
  }
}
