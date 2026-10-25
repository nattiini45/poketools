import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAnyAdmin } from '@/lib/auth/helpers';
import { getAdminScope, scopeAllowsTournament } from '@/lib/auth/admin-scope';
import { safeErrorResponse } from '@/lib/api/error-response';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import { formatZodErrors } from '@/lib/validation';
import { logAuditEvent } from '@/lib/audit/log';
import {
  adminMatchBatchSchema,
  summarizeBulkResults,
  type AdminMatchBatchResponse,
} from '@/lib/admin/match-bulk';
import { runBulkAction } from '@/lib/match/bulk-actions';
import { getMatchesByIds } from '@/lib/supabase/queries/matches';
import type { MatchWithPlayers } from '@/types/match';
import type { ApiResult } from '@/types/api';

// Confirming runs finalize (ratings, streaks, achievements, bracket writes) per match, one after another; the
// processor stops starting items at 240 s so the response still goes out inside this budget.
export const maxDuration = 300;

/**
 * POST /api/admin/matches/batch — one action over up to 100 matches of the matches list.
 *
 * Body: `{ action: 'confirm' | 'schedule' | 'note', match_ids: uuid[], params }`: `confirm` takes
 * `{ expected: [{ match_id, winner_id, status: 'pending_confirmation' }] }`, one entry per id, the reported winner the
 * admin previewed (a match whose winner differs now is a per-item `match_bulk_conflict`, nothing written),
 * `schedule` takes `{ scheduled_at }` (an ISO instant with an offset), `note` takes `{ note }` (appended to the
 * existing notes). Unknown keys are a 400.
 *
 * Scope is checked for every match before anything is written: one match outside the caller's leagues and
 * tournaments is a 403 for the whole request, with no per-id detail. An id that does not exist is not a request
 * error but a per-item `match_not_found`. A processed request answers 200 with one result per id in request order
 * and a summary, even when every item failed; the codes are in `src/i18n/messages/errors`.
 *
 * Audit: one event per changed match plus one `match.bulk_action` summary event.
 */
export async function POST(request: NextRequest) {
  try {
    const player = await requireAnyAdmin();
    const scope = await getAdminScope(player);

    const rate = await checkRateLimit('admin-match-batch', player.playerId, { limit: 30, windowSeconds: 60 * 60 });
    if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);

    const rawBody = await request.json().catch(() => null);
    const parsed = adminMatchBatchSchema.safeParse(rawBody);
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }
    const input = parsed.data;

    const matches = await getMatchesByIds(input.match_ids);
    // Every found match must be in scope before any write; one that is not refuses the whole request.
    if (matches.some((match) => !scopeAllowsTournament(scope, match.tournament_id))) {
      throw new AuthError('Admin access required for this resource', 403, 'forbidden');
    }
    const matchesById = new Map<string, MatchWithPlayers>(matches.map((match) => [match.id, match]));

    const batchId = randomUUID();
    const outcomes = await runBulkAction(input, matchesById, {
      actor: { playerId: player.playerId, name: player.name },
      batchId,
    });
    const results = outcomes.map((outcome) => outcome.result);
    const summary = summarizeBulkResults(results);

    // Fire-and-forget: one event per changed match, then the summary.
    for (const outcome of outcomes) {
      if (outcome.audit) {
        logAuditEvent({ actor_id: player.playerId, actor_name: player.name, ...outcome.audit });
      }
    }
    logAuditEvent({
      actor_id: player.playerId,
      actor_name: player.name,
      action: 'match.bulk_action',
      resource_type: 'match_batch',
      resource_id: null,
      metadata: { batch_id: batchId, action: input.action, ...summary, match_ids: input.match_ids },
    });

    return NextResponse.json<ApiResult<AdminMatchBatchResponse>>({
      success: true,
      data: { action: input.action, results, summary },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to run the bulk action');
  }
}
