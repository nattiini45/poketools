/**
 * Deferred aggregate processing queue.
 *
 * `recordGameResult` enqueues a job instead of counting the game
 * synchronously. Jobs are processed by `processAggregateJobs`, called from:
 *   1. `after()` in the API route (near-immediate, same serverless invocation)
 *   2. Vercel Cron (every 10 minutes — safety net for crash-orphaned jobs)
 *   3. the admin drain (`drainPendingAggregateJobs`)
 *
 * A job's increments, the game's `aggregate_applied_at` marker and the job's
 * completion commit in ONE transaction (`apply_aggregate_job`), so a retried,
 * reclaimed or duplicate job can never count a game twice. A scope rebuild
 * leaves games with a live job to the queue (`listGameIdsWithLiveIncrementJobs`),
 * so it does not count them a second time either.
 *
 * `editGame`/`deleteGame` cancel pending jobs for the target game before
 * their synchronous rollback to prevent double-counting; a cancel that fails
 * throws, so they abort before touching aggregates. The rollback is
 * `rollback_game_aggregates` (decrements + marker clear in one transaction,
 * fenced on the marker). `editGame` re-applies through
 * `applyGameAggregatesNow`, the same atomic apply with a job row it inserts
 * already `processing`, and re-queues the game with `enqueueAggregateJob`
 * when it fails between its rollback and that re-apply.
 *
 * Failure semantics: a failing job is a counted, retriable `failed` (the run
 * still resolves). A failed reclaim, claim or queue write (completing or
 * failing a job) rejects the run, so the cron answers 5xx instead of a green
 * success while the queue cannot move.
 */

import { supabase } from '@/lib/supabase/client';
import {
  applyAggregateJob,
  buildGameAggregateDeltas,
  type ApplyAggregateJobOutcome,
  type GameAggregateDeltas,
} from '@/lib/supabase/queries/aggregates';
import {
  getBattleStatsByGame,
  getGameById,
  isLiveIncrementJob,
} from '@/lib/supabase/queries/games';
import { revalidateMatchPages } from '@/lib/revalidation';

// ─── Types ─────────────────────────────────────────────────────────

export type AggregateJobOperation = 'increment' | 'decrement';
export type AggregateJobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface AggregateJob {
  id: string;
  game_id: string;
  tournament_id: string;
  season_id: string | null;
  operation: AggregateJobOperation;
  status: AggregateJobStatus;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  processed_at: string | null;
}

export interface ProcessAggregateJobsResult {
  processed: number;
  failed: number;
  reclaimed: number;
}

export interface AggregateJobStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  cancelled: number;
}

// ─── Enqueue ───────────────────────────────────────────────────────

/**
 * Insert a pending aggregate job for a newly recorded game.
 * Called from `recordGameResult` for every new game, and from `editGame`
 * when an edit fails after it may have left the game uncounted.
 */
export async function enqueueAggregateJob(
  gameId: string,
  tournamentId: string,
  seasonId: string | null
): Promise<void> {
  const { error } = await supabase.from('aggregate_jobs').insert({
    game_id: gameId,
    tournament_id: tournamentId,
    season_id: seasonId,
    operation: 'increment',
    status: 'pending',
  });

  if (error) {
    console.error('[aggregate-queue] Failed to enqueue job:', error);
    throw error;
  }
}


// ─── Process ───────────────────────────────────────────────────────

/**
 * A write to `aggregate_jobs` itself failed (completing a job, or returning
 * a failed job to the queue). Distinct from a job's own failure: the queue's
 * bookkeeping is broken, so the run must not report success.
 */
export class AggregateQueueWriteError extends Error {
  constructor(message: string, options: { cause: unknown }) {
    super(message, options);
    this.name = 'AggregateQueueWriteError';
  }
}

/**
 * The run finished its batch but the queue's own housekeeping failed (the
 * reclaim RPC, or one or more queue writes). Carries the partial result and
 * every underlying error for the server log; `cause` is the first one.
 */
export class AggregateQueueRunError extends Error {
  readonly result: ProcessAggregateJobsResult;
  readonly errors: readonly unknown[];

  constructor(result: ProcessAggregateJobsResult, errors: readonly unknown[]) {
    super(
      `Aggregate queue run failed: ${errors.length} housekeeping error(s) ` +
        `(processed ${result.processed}, failed ${result.failed}, reclaimed ${result.reclaimed})`,
      { cause: errors[0] },
    );
    this.name = 'AggregateQueueRunError';
    this.result = result;
    this.errors = errors;
  }
}

/**
 * The claim RPC failed, so nothing was claimed and nothing was applied. The
 * RPC error is the `cause`; distinct from `AggregateQueueRunError` so the
 * cron can answer a code per failure cause.
 */
export class AggregateQueueClaimError extends Error {
  constructor(options: { cause: unknown }) {
    super('Failed to claim aggregate jobs', options);
    this.name = 'AggregateQueueClaimError';
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err && typeof err.message === 'string') {
    return err.message;
  }
  return String(err);
}

/**
 * Process pending aggregate jobs. Reclaims stale `processing` jobs, claims a
 * batch, applies each one atomically, and revalidates the touched tournaments.
 *
 * Called by the cron endpoint, by `after()` in API routes and by the admin drain.
 *
 * Throws an `AggregateQueueClaimError` (cause: the claim RPC error) when the
 * batch cannot be claimed. Throws an
 * `AggregateQueueRunError` after the batch when the reclaim RPC failed (fresh
 * jobs are still claimed and applied first) or when a queue write failed.
 * A job whose own processing fails is retried later and only counted in
 * `failed`: the run still resolves.
 *
 * @param limit  Max jobs to claim in this run. Default 20.
 */
export async function processAggregateJobs(limit = 20): Promise<ProcessAggregateJobsResult> {
  const result: ProcessAggregateJobsResult = { processed: 0, failed: 0, reclaimed: 0 };
  const housekeepingErrors: unknown[] = [];

  // 1. Reclaim jobs orphaned in 'processing' state (serverless crash). A
  //    failure is logged and fails the run, but fresh jobs are still claimed.
  const { data: reclaimed, error: reclaimError } = await supabase.rpc('reclaim_stale_aggregate_jobs');
  if (reclaimError) {
    console.error('[aggregate-queue] Reclaim error:', reclaimError);
    housekeepingErrors.push(reclaimError);
  } else {
    result.reclaimed = reclaimed;
  }

  // 2. Claim a batch of pending jobs. Nothing is claimed on error, so nothing
  //    is left half-done: fail the run right away.
  const { data: claimedJobs, error: claimError } = await supabase.rpc(
    'claim_aggregate_jobs',
    { p_limit: limit }
  );

  if (claimError) {
    console.error('[aggregate-queue] Claim error:', claimError);
    throw new AggregateQueueClaimError({ cause: claimError });
  }

  // 3. Process each claimed job
  const affectedTournamentIds = new Set<string>();
  for (const job of (claimedJobs ?? []) as AggregateJob[]) {
    try {
      const aggregatesUpdated = await processJob(job);
      result.processed++;
      if (aggregatesUpdated) {
        affectedTournamentIds.add(job.tournament_id);
      }
    } catch (err) {
      console.error(`[aggregate-queue] Job ${job.id} failed:`, err);
      result.failed++;
      if (err instanceof AggregateQueueWriteError) housekeepingErrors.push(err);
      try {
        await markJobFailed(job.id, errorMessage(err));
      } catch (markErr) {
        housekeepingErrors.push(markErr);
      }
    }
  }

  // Bust ISR/CDN after aggregates apply (enqueue-time revalidate in result-effects is too early)
  if (affectedTournamentIds.size > 0) {
    await Promise.all(
      [...affectedTournamentIds].map((tournamentId) => revalidateMatchPages(tournamentId))
    );
  }

  if (housekeepingErrors.length > 0) {
    throw new AggregateQueueRunError(result, housekeepingErrors);
  }

  return result;
}

/** @returns whether this job changed aggregates (the tournament needs revalidating). */
async function processJob(job: AggregateJob): Promise<boolean> {
  const game = await getGameById(job.game_id);
  if (!game) {
    await completeJob(job.id);
    return false;
  }

  // Fast path; apply_aggregate_job re-checks the marker under the game row lock.
  if (game.aggregate_applied_at) {
    await completeJob(job.id);
    return false;
  }

  // Re-fetch battle stats from DB (source of truth, not stored in job payload)
  const stats = await getBattleStatsByGame(job.game_id);
  if (stats.length === 0) {
    // Game was deleted between enqueue and processing — mark completed, nothing to do
    await completeJob(job.id);
    return false;
  }

  if (job.operation !== 'increment') {
    // Only increments are queued. Admin edit/delete/reset roll a game back
    // synchronously through rollbackGameAggregates (one fenced transaction).
    throw new Error(`Unsupported operation: ${job.operation}`);
  }

  // Read the frozen, creation-time decision from the games row so flipping
  // test flags after the match exists cannot drift all_time aggregates.
  const deltas = buildGameAggregateDeltas(stats, job.tournament_id, job.season_id, {
    excludeAllTime: game.exclude_all_time,
  });

  // Increments + marker + job completion in one transaction.
  const outcome = await applyAggregateJob(job.id, job.game_id, deltas);
  switch (outcome) {
    case 'applied':
      return true;
    case 'already_applied': // another run applied it first; job completed by the RPC
    case 'game_missing': // game deleted meanwhile; job completed by the RPC
    case 'job_not_processing': // cancelled by edit/delete, or reclaimed and finished elsewhere
      return false;
  }
}

async function completeJob(jobId: string): Promise<void> {
  // Guard: only mark completed if still in 'processing' (could have been cancelled)
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('aggregate_jobs')
    .update({ status: 'completed', processed_at: now, updated_at: now })
    .eq('id', jobId)
    .eq('status', 'processing');

  if (error) {
    console.error(`[aggregate-queue] Complete error for job ${jobId}:`, error);
    throw new AggregateQueueWriteError(`Failed to complete aggregate job ${jobId}`, { cause: error });
  }
}

async function markJobFailed(jobId: string, errorMessage: string): Promise<void> {
  // If we've exhausted attempts, mark permanently failed; otherwise reset to pending
  const { data: job, error: readError } = await supabase
    .from('aggregate_jobs')
    .select('attempts, max_attempts')
    .eq('id', jobId)
    .eq('status', 'processing')
    .maybeSingle();

  if (readError) {
    console.error(`[aggregate-queue] Mark-failed read error for job ${jobId}:`, readError);
    throw new AggregateQueueWriteError(`Failed to read aggregate job ${jobId} to mark it failed`, {
      cause: readError,
    });
  }

  // No longer processing: cancelled (edit/delete) or completed meanwhile. Nothing to undo.
  if (!job) return;

  const newStatus: AggregateJobStatus =
    job.attempts >= job.max_attempts ? 'failed' : 'pending';

  const { error: updateError } = await supabase
    .from('aggregate_jobs')
    .update({
      status: newStatus,
      last_error: errorMessage,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .eq('status', 'processing');

  if (updateError) {
    console.error(`[aggregate-queue] Mark-failed update error for job ${jobId}:`, updateError);
    throw new AggregateQueueWriteError(`Failed to mark aggregate job ${jobId} ${newStatus}`, {
      cause: updateError,
    });
  }
}

// ─── Cancel ───────────────────────────────────────────────────────

/**
 * Cancel all pending/processing jobs for a game.
 * Called from `editGame` and `deleteGame` before synchronous rollback to prevent
 * double-counting if the game is edited before its aggregate job is processed.
 *
 * Throws when the cancel RPC fails: a job left pending would apply the game's
 * old stats later, so the caller must abort before touching aggregates.
 *
 * @returns The number of jobs cancelled.
 */
export async function cancelAggregateJobsForGame(gameId: string): Promise<number> {
  const { data, error } = await supabase.rpc('cancel_aggregate_jobs_for_game', {
    p_game_id: gameId,
  });

  if (error) {
    console.error('[aggregate-queue] Cancel error:', error);
    throw error;
  }

  return data;
}

// ─── Synchronous apply (admin edit) ───────────────────────────────

/**
 * The game could not be applied synchronously: the atomic apply reported an
 * outcome other than `applied` (a concurrent edit or delete of the same game
 * won the race). Nothing was written by the apply.
 */
export class SyncAggregateApplyConflictError extends Error {
  readonly outcome: Exclude<ApplyAggregateJobOutcome, 'applied'>;

  constructor(gameId: string, outcome: Exclude<ApplyAggregateJobOutcome, 'applied'>) {
    super(`Synchronous aggregate apply for game ${gameId} did not apply: ${outcome}`);
    this.name = 'SyncAggregateApplyConflictError';
    this.outcome = outcome;
  }
}

/**
 * Apply one game's current battle stats to the aggregates NOW, through the
 * same atomic `apply_aggregate_job` the queue uses, so the increments, the
 * game's `aggregate_applied_at` marker and the job's completion commit in ONE
 * transaction. Used by `editGame`'s re-apply, which used to
 * send the increments and the marker as two requests: a marker write that
 * failed (or timed out) after the increments committed left the game counted
 * with the marker NULL, and a retried edit skipped the rollback and counted it
 * twice.
 *
 * The job row is inserted already `processing` (claim never picks it up). If
 * the apply RPC fails the row stays `processing`; after five minutes
 * `reclaim_stale_aggregate_jobs` returns it to the queue, which then applies
 * the game's stats as they are in the database (the edit's new stats), unless
 * a retried edit cancels it first (`cancelAggregateJobsForGame`). If the RPC
 * committed but the response was lost, the marker is set and the job is
 * completed, so a retried edit rolls the game back exactly once.
 *
 * Throws the insert or RPC error, and `SyncAggregateApplyConflictError` when
 * the apply did not happen.
 */
export async function applyGameAggregatesNow(
  gameId: string,
  tournamentId: string,
  seasonId: string | null,
  deltas: GameAggregateDeltas,
): Promise<void> {
  const { data: job, error } = await supabase
    .from('aggregate_jobs')
    .insert({
      game_id: gameId,
      tournament_id: tournamentId,
      season_id: seasonId,
      operation: 'increment',
      status: 'processing',
      attempts: 1,
    })
    .select('id')
    .single();

  if (error) {
    console.error(`[aggregate-queue] Failed to create the synchronous apply job for game ${gameId}:`, error);
    throw error;
  }

  const outcome = await applyAggregateJob(job.id, gameId, deltas);
  if (outcome !== 'applied') {
    throw new SyncAggregateApplyConflictError(gameId, outcome);
  }
}

// ─── Rebuild fence ─────────────────────────────────────────────────

/** PostgREST `max_rows` (supabase/config.toml): a shorter page ends the read. */
const LIVE_JOBS_PAGE_SIZE = 1000;

/**
 * Ids of the games whose increment job the queue can still apply
 * (`isLiveIncrementJob`). A scope rebuild reads this right after it clears the
 * scope and skips these games: their job counts them into the cleared scope,
 * even when it applies before the rebuild's page reaches the game. Pages past
 * `max_rows`; errors propagate.
 */
export async function listGameIdsWithLiveIncrementJobs(): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let from = 0; ; from += LIVE_JOBS_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('aggregate_jobs')
      .select('game_id, operation, status, attempts, max_attempts')
      .eq('operation', 'increment')
      .in('status', ['pending', 'processing'])
      .order('id', { ascending: true })
      .range(from, from + LIVE_JOBS_PAGE_SIZE - 1);
    if (error) {
      console.error('[aggregate-queue] Live job read failed:', error);
      throw error;
    }
    const rows = data ?? [];
    for (const row of rows) {
      if (isLiveIncrementJob(row)) ids.add(row.game_id);
    }
    if (rows.length < LIVE_JOBS_PAGE_SIZE) return ids;
  }
}

// ─── Health ───────────────────────────────────────────────────────

export interface AggregateJobHealth {
  /** Pending jobs whose attempts are exhausted: claim can never pick them up. */
  strandedPending: number;
  /** Jobs `processing` for more than 15 minutes (three reclaim windows). */
  staleProcessing: number;
}

/**
 * Queue rows that can never drain on their own (`aggregate_job_health`).
 * Both counts should always be zero; the cron fails while either is not.
 * Throws when the probe fails.
 */
export async function getAggregateJobHealth(): Promise<AggregateJobHealth> {
  const { data, error } = await supabase.rpc('aggregate_job_health');

  if (error) {
    console.error('[aggregate-queue] Health check error:', error);
    throw error;
  }

  // An aggregate without GROUP BY always returns exactly one row.
  const row = data[0];
  if (!row) {
    throw new Error('aggregate_job_health returned no row');
  }

  return { strandedPending: row.stranded_pending, staleProcessing: row.stale_processing };
}

/**
 * Number of jobs that ended `failed` (attempts exhausted, or reclaimed with
 * exhausted attempts). Their games are not counted in the aggregates until an
 * admin rebuilds the scope. One head-only exact count; throws when it fails.
 */
export async function countFailedAggregateJobs(): Promise<number> {
  const { count, error } = await supabase
    .from('aggregate_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'failed');

  if (error) {
    console.error('[aggregate-queue] Failed-job count error:', error);
    throw error;
  }
  if (count === null) {
    throw new Error('aggregate_jobs failed-job count returned no count');
  }
  return count;
}

// ─── Diagnostics ──────────────────────────────────────────────────

const JOB_STATUSES: readonly AggregateJobStatus[] = [
  'pending',
  'processing',
  'completed',
  'failed',
  'cancelled',
];

/**
 * Returns counts of jobs by status. Useful for admin monitoring.
 *
 * One head-only exact count per status: no rows cross the wire. The old
 * `select('status')` downloaded one row per job and was silently capped at
 * PostgREST `max_rows` (1000), so the counts froze once finished jobs piled
 * up. A failed count throws instead of reading as zero, because the drain
 * loop in `aggregate-rebuild.ts` stops as soon as pending and processing are 0.
 */
export async function getAggregateJobStats(): Promise<AggregateJobStats> {
  const results = await Promise.all(
    JOB_STATUSES.map((status) =>
      supabase
        .from('aggregate_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('status', status),
    ),
  );

  const counts: AggregateJobStats = {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  };

  results.forEach(({ count, error }, i) => {
    const status = JOB_STATUSES[i];
    if (error) {
      console.error(`[aggregate-queue] Job count failed for status ${status}:`, error);
      throw error;
    }
    counts[status] = count ?? 0;
  });

  return counts;
}
