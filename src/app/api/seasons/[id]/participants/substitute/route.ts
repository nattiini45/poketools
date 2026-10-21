import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { seasonParticipantSubstituteSchema, formatZodErrors } from '@/lib/validation';
import {
  emptySubstituteApplyLog,
  substituteParticipant,
  substitutePartialApply,
  type SubstituteApplyError,
  type SubstitutePartialApply,
  type SubstituteSummary,
} from '@/lib/season/substitute';
import { logAuditEvent, type AuditLogEntry } from '@/lib/audit/log';
import { expireSeasonReads } from '@/lib/revalidation';
import { getStagesBySeasonId } from '@/lib/supabase/queries/tournaments';
import type { ApiError, ApiResult } from '@/types/api';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/seasons/[id]/participants/substitute
 *
 * Swap roster membership and non-completed phase enrollments (the incoming
 * player takes the whole phase slot: seed, starting bracket, group row).
 * Repairs scheduled matches with zero games. Pass dry_run: true for preview.
 * A completed or archived league takes no substitution (409 `SEASON_CLOSED`).
 *
 * A failed apply answers with its own error and code (`safeErrorResponse`)
 * plus `partial`: exactly what it wrote before it stopped
 * (`SubstitutePartialApply`, the apply log), or null when it wrote nothing.
 */

const FALLBACK = 'Failed to substitute participant';

/**
 * After an apply that failed partway (the steps are not one transaction, but
 * a re-run resumes them), expire the league's reads so its pages do not keep
 * serving the pre-write state. The substitution's own error is what the
 * caller gets; a failure here is only logged.
 */
async function expireAfterFailedApply(seasonId: string): Promise<void> {
  try {
    const stages = await getStagesBySeasonId(seasonId);
    expireSeasonReads(seasonId, stages.map((stage) => stage.id));
  } catch (expireErr) {
    console.error('[substitute] read-cache expiry after a failed apply failed:', expireErr);
  }
}

/**
 * The error response of a failed apply, with its partial signal added to the
 * body `safeErrorResponse` built (same status, message and code).
 */
async function withPartialSignal(
  response: NextResponse<ApiResult<never>>,
  partial: SubstitutePartialApply | null,
): Promise<NextResponse<SubstituteApplyError>> {
  const body = (await response.json()) as ApiError;
  return NextResponse.json<SubstituteApplyError>({ ...body, partial }, { status: response.status });
}

/**
 * The `season.participant.substitute` entry. `phase_ids` names the phases the
 * substitution handed over (the group repair follows a chain of
 * substitutions only through the phases each one touched), `groups` the group
 * rows that moved with them.
 */
function substituteAuditEntry(
  actor: { playerId: string; name: string },
  seasonId: string,
  body: { out_player_id: string; in_player_id: string; scope: string },
  metadata: Record<string, unknown>,
): AuditLogEntry {
  return {
    actor_id: actor.playerId,
    actor_name: actor.name,
    action: 'season.participant.substitute',
    resource_type: 'season',
    resource_id: seasonId,
    changes: {
      out_player_id: { before: body.out_player_id, after: body.in_player_id },
    },
    metadata: { scope: body.scope, ...metadata },
  };
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: seasonId } = await params;
    const admin = await requireResourceAdmin('season', seasonId);
    const invalidSeasonId = rejectInvalidPathId(seasonId, 'INVALID_SEASON_ID');
    if (invalidSeasonId) return invalidSeasonId;

    const rawBody = await request.json().catch(() => null);
    const zodResult = seasonParticipantSubstituteSchema.safeParse(rawBody);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 },
      );
    }

    const body = zodResult.data;
    const dryRun = body.dry_run ?? false;
    const log = emptySubstituteApplyLog();
    let summary: SubstituteSummary;
    try {
      summary = await substituteParticipant({
        seasonId,
        outPlayerId: body.out_player_id,
        inPlayerId: body.in_player_id,
        scope: body.scope,
        dryRun,
        log,
      });
    } catch (err) {
      if (dryRun) throw err;
      await expireAfterFailedApply(seasonId);
      // The steps before the failure have landed and a re-run no longer plans
      // them, so they are recorded now, with the step the apply stopped at (as
      // the group repair records its partial applies), and returned to the
      // caller as the partial signal. A failure before the first write
      // records nothing and returns `partial: null`.
      const partial = substitutePartialApply(log);
      if (partial) {
        void logAuditEvent(
          substituteAuditEntry(admin, seasonId, body, {
            partial: true,
            failure_code: err instanceof UserFacingError ? (err.code ?? null) : null,
            phase_ids: partial.phase_ids,
            written: partial.written,
            stopped_at: partial.stopped_at,
          }),
        );
      }
      return withPartialSignal(safeErrorResponse(err, FALLBACK), partial);
    }

    if (!dryRun) {
      expireSeasonReads(seasonId, summary.phases.map((phase) => phase.phase_id));
      void logAuditEvent(
        substituteAuditEntry(admin, seasonId, body, {
          phases_updated: summary.phases.length,
          matches_repaired: summary.matches_repaired,
          phase_ids: summary.phases.map((phase) => phase.phase_id),
          groups: log.groups_handed_over.filter((step) => step.group_id !== null),
          matches_skipped: summary.matches_skipped.map((match) => ({
            match_id: match.match_id,
            reason: match.reason,
          })),
        }),
      );
    }

    return NextResponse.json<ApiResult<SubstituteSummary>>({ success: true, data: summary });
  } catch (err) {
    return safeErrorResponse(err, FALLBACK);
  }
}
