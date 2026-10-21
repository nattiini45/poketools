import { NextResponse } from 'next/server';
import { z } from 'zod';
import { safeErrorResponse } from '@/lib/api/error-response';
import {
  findMatchesNeedingAdmin,
  finalizeMatchCompletion,
  healMatchFinalization,
  type FinalizeStep,
} from '@/lib/match/finalize';
import {
  getMatchById,
  listMatchesNeedingFinalize,
  listMatchesReadyForAutoConfirm,
  updateMatchStatus,
  type FinalizeWorklistCursor,
} from '@/lib/supabase/queries/matches';
import { logAuditEvent } from '@/lib/audit/log';
import { timingSafeCompare } from '@/lib/utils/crypto';
import { formatZodErrors } from '@/lib/validation';
import type { ApiResult } from '@/types/api';

// Finalize runs ratings, streaks, achievements, EPB hooks and bracket writes per
// match; like the other heavy routes, give the batch the full function budget.
export const maxDuration = 300;

/** A completed match whose finalize has not stamped finalized_at for this long is healed. */
const HEAL_GRACE_MS = 10 * 60 * 1000;
/** Heal attempts (healed or failed) per run. Skipped and needs-admin rows do not count. */
const HEAL_BATCH_LIMIT = 25;
/** Worklist rows read per page (one batched rating_history read classifies a page). */
const HEAL_PAGE_SIZE = 100;
/**
 * Pages walked per run. The scan pages past needs-admin and skipped rows
 * (keyset cursor), so they cannot hold the head of the oldest-first worklist
 * and starve the healable rows behind them; this cap bounds the reads of one
 * run. A run that stops at the cap with rows left reports
 * `heal.scan_truncated` and logs it.
 */
const HEAL_MAX_PAGES = 10;
/** Pending results confirmed per run when the caller passes no `limit`. */
const DEFAULT_CONFIRM_LIMIT = 25;

/** `?limit=` must be an integer in 1..100; anything else is a 400, never a silent default. */
const autoConfirmQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

interface MatchFailure {
  match_id: string;
  /** Finalize steps that failed, or `confirm` when the match could not be confirmed at all. */
  steps: Array<FinalizeStep | 'confirm'>;
  /** Why the heal needs an admin (needs_admin entries only). */
  reason?: string;
}

interface AutoConfirmResult {
  /**
   * Completed matches only an admin can finish (rating_history missing, or
   * the winner is not a participant), by id. Reported and logged at error
   * level every run, but they do not fail the run (lead ruling CR-2): the
   * cron answers 200 when they are the only problem. See docs/match.md.
   */
  needsAdmin: string[];
  checked: number;
  completed: number;
  skipped_no_winner: number;
  /** The match left pending_confirmation (confirmed or disputed) between the list and the write. */
  skipped_conflict: number;
  failed: MatchFailure[];
  heal: {
    checked: number;
    healed: number;
    /** Nothing to heal (match reset meanwhile). */
    skipped: number;
    /** Retried next run; each spends one heal attempt. */
    failed: MatchFailure[];
    /**
     * Only an admin can repair these (ratings missing, no participant winner),
     * with the reason. They spend no heal attempt and do not fail the run;
     * their ids are also in `needsAdmin`.
     */
    needs_admin: MatchFailure[];
    /** The scan stopped at HEAL_MAX_PAGES with worklist rows left unread. */
    scan_truncated: boolean;
  };
}

/**
 * The confirm write (or something after it) threw. Re-read the match so the
 * log tells a committed-but-unfinalized completion (lost response, request
 * timeout after the UPDATE committed) from a write that never landed. Never
 * finalizes here: a concurrent confirm may be finalizing the same match, and
 * the heal picks a committed completion up after the grace period.
 */
async function logStatusAfterConfirmError(matchId: string): Promise<void> {
  try {
    const latest = await getMatchById(matchId);
    if (!latest) {
      console.error(`[cron/auto-confirm] match ${matchId} no longer exists after the failed auto-confirm`);
    } else if (latest.status === 'completed') {
      console.error(
        `[cron/auto-confirm] match ${matchId} is completed although the auto-confirm failed: ` +
          'the completion committed but finalize did not run in this request; the heal takes it over ' +
          'after the grace period (it shows up under needsAdmin unless rating_history exists)'
      );
    } else {
      console.error(
        `[cron/auto-confirm] match ${matchId} is still ${latest.status}: the auto-confirm write did not commit`
      );
    }
  } catch (readErr) {
    console.error(`[cron/auto-confirm] could not re-read match ${matchId} after the failed auto-confirm`, readErr);
  }
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
    const parsed = autoConfirmQuerySchema.safeParse({ limit: searchParams.get('limit') ?? undefined });
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }
    const limit = parsed.data.limit ?? DEFAULT_CONFIRM_LIMIT;
    const now = Date.now();
    const matches = await listMatchesReadyForAutoConfirm(new Date(now).toISOString(), limit);

    const result: AutoConfirmResult = {
      needsAdmin: [],
      checked: matches.length,
      completed: 0,
      skipped_no_winner: 0,
      skipped_conflict: 0,
      failed: [],
      heal: { checked: 0, healed: 0, skipped: 0, failed: [], needs_admin: [], scan_truncated: false },
    };

    // Pass 1: confirm elapsed pending results. Each match is isolated: one
    // failure is recorded and the batch goes on.
    for (const match of matches) {
      if (!match.winner_id) {
        result.skipped_no_winner += 1;
        continue;
      }
      const winnerId = match.winner_id;

      try {
        // Compare-and-set on pending_confirmation: a player confirm or dispute
        // that landed after the list read wins, and finalize never runs twice.
        const updated = await updateMatchStatus(
          match.id,
          'completed',
          winnerId,
          undefined,
          match.notes ? `${match.notes}\nAuto-confirmed after timeout.` : 'Auto-confirmed after timeout.',
          'pending_confirmation'
        );
        if (!updated) {
          result.skipped_conflict += 1;
          continue;
        }

        const finalize = await finalizeMatchCompletion({
          match: { ...match, winner_id: winnerId, status: 'completed' },
          winnerId,
          previousStatus: 'pending_confirmation',
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
            winner_id: winnerId,
          },
        });
        result.completed += 1;

        if (!finalize.finalized) {
          console.error(
            `[cron/auto-confirm] finalize did not run for match ${match.id}: ${finalize.reason ?? 'unknown'}`
          );
          result.failed.push({ match_id: match.id, steps: ['confirm'] });
        } else if (finalize.failed_steps && finalize.failed_steps.length > 0) {
          // Each step already logged its own error; the heal pass picks the
          // match up once the grace period is over.
          result.failed.push({ match_id: match.id, steps: finalize.failed_steps });
        }
      } catch (err) {
        console.error(`[cron/auto-confirm] could not auto-confirm match ${match.id}`, err);
        await logStatusAfterConfirmError(match.id);
        result.failed.push({ match_id: match.id, steps: ['confirm'] });
      }
    }

    // Pass 2: heal completed matches whose finalize did not finish. Keyset
    // paging walks past rows the heal cannot act on, so they never starve the
    // healable rows behind them.
    const healCutoff = new Date(now - HEAL_GRACE_MS).toISOString();
    let cursor: FinalizeWorklistCursor | undefined;
    let healAttempts = 0;
    let page = 0;
    scan: for (;;) {
      if (page >= HEAL_MAX_PAGES) {
        // Rows may wait behind the last one read; the next run starts at the
        // head again, so report it instead of reading on.
        const more = await listMatchesNeedingFinalize(healCutoff, 1, cursor);
        result.heal.scan_truncated = more.length > 0;
        break;
      }
      const rows = await listMatchesNeedingFinalize(healCutoff, HEAL_PAGE_SIZE, cursor);
      page += 1;
      if (rows.length === 0) break;
      const needsAdmin = await findMatchesNeedingAdmin(rows);

      for (const match of rows) {
        if (healAttempts >= HEAL_BATCH_LIMIT) break scan;
        cursor = { updated_at: match.updated_at, id: match.id };
        result.heal.checked += 1;

        const adminReason = needsAdmin.get(match.id);
        if (adminReason) {
          result.heal.needs_admin.push({ match_id: match.id, steps: [], reason: adminReason });
          continue;
        }

        try {
          const heal = await healMatchFinalization(match);
          if (heal.skipped) {
            console.warn(`[cron/auto-confirm] heal skipped match ${match.id}: ${heal.reason ?? 'unknown'}`);
            result.heal.skipped += 1;
            continue;
          }
          if (heal.needs_admin) {
            // State changed between the classification and the heal; the heal
            // already logged the cause.
            result.heal.needs_admin.push({
              match_id: match.id,
              steps: heal.failed_steps,
              ...(heal.reason ? { reason: heal.reason } : {}),
            });
            continue;
          }
          healAttempts += 1;
          if (heal.healed) {
            result.heal.healed += 1;
          } else {
            console.error(
              `[cron/auto-confirm] heal incomplete for match ${match.id}: ` +
                (heal.failed_steps.length > 0 ? heal.failed_steps.join(', ') : heal.reason ?? 'unknown')
            );
            result.heal.failed.push({ match_id: match.id, steps: heal.failed_steps });
          }
        } catch (err) {
          healAttempts += 1;
          console.error(`[cron/auto-confirm] heal threw for match ${match.id}`, err);
          result.heal.failed.push({ match_id: match.id, steps: [] });
        }
      }
      if (rows.length < HEAL_PAGE_SIZE) break;
    }

    result.needsAdmin = result.heal.needs_admin.map((entry) => entry.match_id);
    if (result.needsAdmin.length > 0) {
      // One line per run (not one per match): these rows stay on the worklist
      // until an admin repairs them (docs/match.md runbook).
      console.error(
        `[cron/auto-confirm] ${result.needsAdmin.length} completed match(es) need an admin: ` +
          result.heal.needs_admin.map((entry) => `${entry.match_id} (${entry.reason ?? 'unknown'})`).join(', ')
      );
    }
    if (result.heal.scan_truncated) {
      console.error(
        `[cron/auto-confirm] heal scan stopped after ${HEAL_MAX_PAGES * HEAL_PAGE_SIZE} worklist rows with more left; ` +
          'needs-admin rows are crowding the worklist'
      );
    }

    const failedCount = result.failed.length + result.heal.failed.length;
    if (failedCount > 0) {
      // Non-2xx so the cron run shows as failed (Vercel 5xx alert); the per-match
      // causes are in the log lines above and in this summary. Needs-admin rows
      // alone never get here (lead ruling CR-2).
      console.error('[cron/auto-confirm] run finished with failures', JSON.stringify(result));
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: `Auto-confirm run finished with ${failedCount} failed match${failedCount === 1 ? '' : 'es'}.`,
          code: 'auto_confirm_partial_failure',
          params: { count: failedCount },
          // Match ids and step names only (the caller holds CRON_SECRET).
          details: JSON.stringify(result),
        },
        { status: 500 }
      );
    }

    return NextResponse.json<ApiResult<AutoConfirmResult>>({ success: true, data: result });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to auto-confirm matches');
  }
}

// Vercel Cron invokes via GET; POST kept for manual/programmatic triggering
export const GET = handle;
export const POST = handle;
