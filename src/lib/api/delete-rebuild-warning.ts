import type { ApiErrorCode } from '@/i18n/messages/errors';
import { UserFacingError } from '@/lib/api/user-facing-error';

/**
 * The derived-data rebuild that follows a committed entity delete (season,
 * tournament, phase) failed. The delete stays a success (it already
 * committed), but the response says so instead of hiding it in the server log
 * and the audit record: `code` is a catalogue key the client renders in the
 * viewer's language (`rating_history_incomplete` when the rating rebuild
 * refused a history gap, otherwise `derived_data_rebuild_failed`), `error` is
 * the English fallback and `params` fills the message's placeholders.
 *
 * A league RESTORED from the trash gets the same warning shape from
 * `toRestoreRebuildWarning` (its texts say "restored", its codes are
 * `restore_rebuild_*`); see the end of this file.
 */
export interface DeleteRebuildWarning {
  code: ApiErrorCode;
  error: string;
  params?: Readonly<Record<string, string | number>>;
}

/** The response body `data` of a season/tournament/phase DELETE. */
export interface EntityDeleteResult {
  /** Null when the rebuild after the delete succeeded. */
  rebuild_warning: DeleteRebuildWarning | null;
  /** A league delete only: the trash entry the league now sits in, and when it is removed for good. */
  trash?: { id: string; purge_after: string };
}

/** The step of the derived-data rebuild after an entity delete that failed. */
export type EntityDeleteRebuildStep = 'aggregates' | 'ratings' | 'streaks' | 'evolution';

/**
 * A step of the derived-data rebuild after an entity delete failed
 * (`src/lib/reconcile/entity-delete-rebuild.ts` wraps each step). `cause` is
 * the step's own error, logged by the route with this error; the step picks
 * the warning code, so each cause stays distinguishable in the response.
 */
export class EntityDeleteRebuildStepError extends Error {
  readonly step: EntityDeleteRebuildStep;

  constructor(step: EntityDeleteRebuildStep, cause: unknown) {
    super(`derived-data rebuild after delete failed in step "${step}"`, { cause });
    this.name = 'EntityDeleteRebuildStepError';
    this.step = step;
  }
}

/**
 * Per-step warning codes and their English fallbacks (the catalogue in
 * src/i18n/messages/errors/admin renders them in the viewer's language). The
 * text is addressed to whoever deleted: a league admin may delete a phase,
 * but the repair tools are site-admin tools, so it names a site admin.
 */
const STEP_WARNINGS: Readonly<Record<EntityDeleteRebuildStep, { code: ApiErrorCode; error: string }>> = {
  aggregates: {
    code: 'delete_rebuild_aggregates_failed',
    error:
      'The delete succeeded, but rebuilding the usage statistics (aggregates) afterwards failed. The failure was logged; a site admin can rebuild the aggregates in the admin data tools.',
  },
  ratings: {
    code: 'delete_rebuild_ratings_failed',
    error:
      'The delete succeeded, but rebuilding the ratings afterwards failed. The failure was logged; a site admin can repair them with Record Reconciliation in the admin data tools.',
  },
  streaks: {
    code: 'delete_rebuild_streaks_failed',
    error:
      'The delete succeeded, but rebuilding the win streaks afterwards failed. The failure was logged; a site admin can repair them with Record Reconciliation in the admin data tools.',
  },
  evolution: {
    code: 'delete_rebuild_evolution_failed',
    error:
      "The delete succeeded, but repairing the league's evolution progress afterwards failed. The failure was logged; a site admin can repair it with Record Reconciliation in the admin data tools.",
  },
};

const GENERIC_MESSAGE =
  'The delete succeeded, but rebuilding the derived data (aggregates, ratings, streaks) afterwards failed. The failure was logged; a site admin can bring the records back in line with Repair in Record Reconciliation (admin data tools).';

function fromUserFacing(err: unknown): DeleteRebuildWarning | null {
  if (err instanceof UserFacingError && err.code) {
    return {
      code: err.code,
      error: err.message,
      ...(err.params ? { params: err.params } : {}),
    };
  }
  return null;
}

/**
 * Maps the rebuild's error to the warning: a catalogued domain refusal keeps
 * its own code, message and params (e.g. `rating_history_incomplete`, 409 from
 * the rating rebuild), also when a rebuild step wrapped it; any other failure
 * of a known step gets that step's code (`delete_rebuild_<step>_failed`), and
 * anything else `derived_data_rebuild_failed`, each with a fixed message
 * (internals stay in the server log).
 */
export function toDeleteRebuildWarning(err: unknown): DeleteRebuildWarning {
  const domain = fromUserFacing(err);
  if (domain) return domain;
  if (err instanceof EntityDeleteRebuildStepError) {
    return fromUserFacing(err.cause) ?? { ...STEP_WARNINGS[err.step] };
  }
  return { code: 'derived_data_rebuild_failed', error: GENERIC_MESSAGE };
}

const TEST_FLAG_MESSAGE =
  "The test-league setting was saved, but rebuilding the league players' ratings afterwards failed. The failure was logged; a site admin can repair them with Record Reconciliation in the admin data tools, repeating the repair until its dry run lists no rating mismatch.";

const TEST_FLAG_UNSETTLED_MESSAGE =
  "The test-league setting was saved and the league players' ratings were rebuilt, but they had not fully settled. A site admin can finish it with Record Reconciliation in the admin data tools, repeating the repair until its dry run lists no rating mismatch.";

/**
 * The same warning shape for the rating rebuild after a test-league flag
 * change (PATCH /api/seasons/[id], `data.rebuild_warning`): the flag is
 * saved, the rebuild of the league's players failed. A catalogued domain
 * refusal keeps its own code, message and params (`rating_history_incomplete`,
 * `rating_rebuild_plan_too_large`); anything else is
 * `test_flag_rating_rebuild_failed` with a fixed message (internals stay in
 * the server log).
 */
export function toTestFlagRebuildWarning(err: unknown): DeleteRebuildWarning {
  return fromUserFacing(err) ?? { code: 'test_flag_rating_rebuild_failed', error: TEST_FLAG_MESSAGE };
}

/**
 * The warning of a flag rebuild that ran to its pass cap while a pass still
 * changed ratings (`TestFlagRatingRebuildSummary.settled` false): the flag is
 * saved and the curves are rebuilt, but not yet settled among themselves.
 */
export function testFlagRebuildUnsettledWarning(): DeleteRebuildWarning {
  return { code: 'test_flag_rating_rebuild_unsettled', error: TEST_FLAG_UNSETTLED_MESSAGE };
}

// ─── The same warning after a league is RESTORED from the trash ──────────────

const RESTORE_STEP_WARNINGS: Readonly<Record<EntityDeleteRebuildStep, { code: ApiErrorCode; error: string }>> = {
  aggregates: {
    code: 'restore_rebuild_aggregates_failed',
    error:
      'The league was restored, but counting its games into the usage statistics (aggregates) afterwards failed. The failure was logged; run the pending rebuild on the trash page again.',
  },
  ratings: {
    code: 'restore_rebuild_ratings_failed',
    error:
      'The league was restored, but rebuilding the ratings afterwards failed. The failure was logged; run the pending rebuild on the trash page again.',
  },
  streaks: {
    code: 'restore_rebuild_streaks_failed',
    error:
      'The league was restored, but rebuilding the win streaks afterwards failed. The failure was logged; run the pending rebuild on the trash page again.',
  },
  evolution: {
    code: 'restore_rebuild_evolution_failed',
    error:
      "The league was restored, but repairing the league's evolution progress afterwards failed. The failure was logged; run the pending rebuild on the trash page again.",
  },
};

const RESTORE_GENERIC_MESSAGE =
  'The league was restored, but rebuilding the derived data (statistics, ratings, streaks) afterwards failed. The failure was logged; run the pending rebuild on the trash page again.';

const RESTORE_UNSETTLED_MESSAGE =
  'The league was restored and the ratings were rebuilt, but they had not fully settled. Run the pending rebuild on the trash page again.';

/**
 * The warning of a failed rebuild after a league restore (`rebuildAfterSeasonRestore`): the same shape and rules as
 * `toDeleteRebuildWarning` (a catalogued domain refusal keeps its own code, a failed step gets its own
 * `restore_rebuild_<step>_failed`, anything else `restore_rebuild_failed`), with texts that say "restored".
 */
export function toRestoreRebuildWarning(err: unknown): DeleteRebuildWarning {
  const domain = fromUserFacing(err);
  if (domain) return domain;
  if (err instanceof EntityDeleteRebuildStepError) {
    return fromUserFacing(err.cause) ?? { ...RESTORE_STEP_WARNINGS[err.step] };
  }
  return { code: 'restore_rebuild_failed', error: RESTORE_GENERIC_MESSAGE };
}

/** The warning of a restore rebuild whose rating settle loop reached its pass cap while a pass still changed ratings. */
export function restoreRebuildUnsettledWarning(): DeleteRebuildWarning {
  return { code: 'restore_rebuild_ratings_unsettled', error: RESTORE_UNSETTLED_MESSAGE };
}
