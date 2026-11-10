import { defineMachine } from '@/lib/state-machine/machine';

const QUEUE = 'src/lib/match/aggregate-queue.ts';
const APPLY_MIGRATION = 'supabase/migrations/20261018130100_aggregate_apply_atomic.sql';

/**
 * The aggregate queue (`aggregate_jobs.status`).
 *
 * Most moves happen inside SQL functions that hold the row locks (claim, apply, reclaim, cancel); those keep their
 * own WHERE guards and `src/lib/match/__tests__/aggregate-job-state.test.ts` pins them to this definition. The TS
 * writers in `aggregate-queue.ts` assert the move and guard their UPDATE with the source state. A job that applied
 * nothing still ends `completed`: whether a game is counted is `games.aggregate_applied_at`
 * (`gameAggregateMarkerMachine`), never the job.
 */
export const aggregateJobMachine = defineMachine({
  id: 'aggregate_job',
  title: 'Aggregate job',
  storage: 'aggregate_jobs.status',
  summary:
    'One queued game count. `enqueueAggregateJob` and `league_trash_restore` insert it `pending`; `applyGameAggregatesNow` (admin game edit) inserts it already `processing` with attempts = 1, so no worker claims it. A claim adds one attempt; a failed run goes back to `pending` while attempts < max_attempts, else to `failed`. Rows go with their game (ON DELETE CASCADE). Whether a game is counted is the game marker, not the job.',
  doc: 'docs/match.md',
  states: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
  initial: ['pending', 'processing'],
  terminal: ['completed', 'cancelled'],
  actors: ['queue', 'admin'],
  transitions: [
    {
      event: 'claim',
      from: ['pending'],
      to: 'processing',
      actors: ['queue'],
      writers: ['supabase/migrations/20260723205115_fix_claim_aggregate_jobs.sql#claim_aggregate_jobs', QUEUE],
      note: 'The worker (cron every 10 min, `after()`, the admin drain) claims pending rows with attempts left, FOR UPDATE SKIP LOCKED, and adds one attempt.',
    },
    {
      event: 'complete',
      from: ['processing'],
      to: 'completed',
      actors: ['queue', 'admin'],
      writers: [`${APPLY_MIGRATION}#apply_aggregate_job`, QUEUE],
      note: 'apply_aggregate_job completes the job in the transaction that adds the counts and sets the game marker; `completeJob` completes a job with nothing to apply (game gone, already counted, no stats).',
    },
    {
      event: 'retry',
      from: ['processing'],
      to: 'pending',
      actors: ['queue'],
      writers: [`${APPLY_MIGRATION}#reclaim_stale_aggregate_jobs`, QUEUE],
      note: 'A failed run (`markJobFailed`) or a run idle for 5 minutes (reclaim) with attempts < max_attempts.',
    },
    {
      event: 'fail',
      from: ['processing'],
      to: 'failed',
      actors: ['queue'],
      writers: [`${APPLY_MIGRATION}#reclaim_stale_aggregate_jobs`, QUEUE],
      note: 'The same two writers once attempts reach max_attempts: the game stays uncounted until a scope rebuild or a requeue.',
    },
    {
      event: 'requeue',
      from: ['failed'],
      to: 'pending',
      actors: ['admin'],
      writers: [QUEUE, 'src/lib/reconcile/entity-delete-rebuild.ts'],
      note: "A league restore rebuild puts the league's failed increment jobs back with attempts = 0 (`requeueFailedIncrementJobsForSeason`).",
    },
    {
      event: 'cancel',
      from: ['pending', 'processing'],
      to: 'cancelled',
      actors: ['admin'],
      writers: ['supabase/migrations/20260608100000_baseline_professional_schema.sql#cancel_aggregate_jobs_for_game', QUEUE],
      note: 'An admin game edit, game delete or match reset cancels the live jobs of the game before it rolls the game back.',
    },
  ],
});
