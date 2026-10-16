/**
 * Deferred aggregate processing queue.
 *
 * `recordGameResult` enqueues a job instead of calling `updateAggregates`
 * synchronously. Jobs are processed by `processAggregateJobs`, called from:
 *   1. `after()` in the API route (near-immediate, same serverless invocation)
 *   2. Vercel Cron (every 10 minutes — safety net for crash-orphaned jobs)
 *
 * `editGame`/`deleteGame` cancel pending jobs for the target game before
 * their synchronous rollback to prevent double-counting.
 */

import { supabase } from '@/lib/supabase/client';
import { updateAggregates } from '@/lib/supabase/queries/aggregates';
import { getBattleStatsByGame, getGameById, markGameAggregatesApplied } from '@/lib/supabase/queries/games';
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
 * Called from `recordGameResult` in place of `updateAggregates`.
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
 * Process pending aggregate jobs. Claims a batch, processes each, and marks
 * them completed or failed. Stale processing jobs are reclaimed first.
 *
 * Called by the cron endpoint and by `after()` in API routes.
 *
 * @param limit  Max jobs to claim in this run. Default 20.
 */
export async function processAggregateJobs(limit = 20): Promise<ProcessAggregateJobsResult> {
  const result: ProcessAggregateJobsResult = { processed: 0, failed: 0, reclaimed: 0 };

  // 1. Reclaim jobs orphaned in 'processing' state (serverless crash)
  const { data: reclaimData } = await supabase.rpc('reclaim_stale_aggregate_jobs');
  result.reclaimed = typeof reclaimData === 'number' ? reclaimData : 0;

  // 2. Claim a batch of pending jobs
  const { data: claimedJobs, error: claimError } = await supabase.rpc(
    'claim_aggregate_jobs',
    { p_limit: limit }
  );

  if (claimError) {
    console.error('[aggregate-queue] Claim error:', claimError);
    return result;
  }

  if (!claimedJobs || claimedJobs.length === 0) {
    return result;
  }

  // 3. Process each claimed job
  const affectedTournamentIds = new Set<string>();
  for (const job of claimedJobs as AggregateJob[]) {
    try {
      const aggregatesUpdated = await processJob(job);
      result.processed++;
      if (aggregatesUpdated) {
        affectedTournamentIds.add(job.tournament_id);
      }
    } catch (err) {
      console.error(`[aggregate-queue] Job ${job.id} failed:`, err);
      await markJobFailed(job.id, err instanceof Error ? err.message : String(err));
      result.failed++;
    }
  }

  // Bust ISR/CDN after aggregates apply (enqueue-time revalidate in result-effects is too early)
  if (affectedTournamentIds.size > 0) {
    await Promise.all(
      [...affectedTournamentIds].map((tournamentId) => revalidateMatchPages(tournamentId))
    );
  }

  return result;
}

async function processJob(job: AggregateJob): Promise<boolean> {
  const game = await getGameById(job.game_id);
  if (!game) {
    await completeJob(job.id);
    return false;
  }

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

  if (job.operation === 'increment') {
    // Read the frozen, creation-time decision from the games row so flipping
    // test flags after the match exists cannot drift all_time aggregates.
    const excludeAllTime = game.exclude_all_time;
    await updateAggregates(stats, job.tournament_id, job.season_id, { excludeAllTime });
    await markGameAggregatesApplied(job.game_id);
  } else {
    // Decrement path exists for completeness but is not used in the hot path.
    // Admin operations call rollbackAggregates directly (synchronously).
    throw new Error(`Unsupported operation: ${job.operation}`);
  }

  await completeJob(job.id);
  return true;
}

async function completeJob(jobId: string): Promise<void> {
  // Guard: only mark completed if still in 'processing' (could have been cancelled)
  await supabase
    .from('aggregate_jobs')
    .update({ status: 'completed', processed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('status', 'processing');
}

async function markJobFailed(jobId: string, errorMessage: string): Promise<void> {
  // If we've exhausted attempts, mark permanently failed; otherwise reset to pending
  const { data: job } = await supabase
    .from('aggregate_jobs')
    .select('attempts, max_attempts')
    .eq('id', jobId)
    .eq('status', 'processing')
    .single();

  if (!job) return;

  const newStatus: AggregateJobStatus =
    job.attempts >= job.max_attempts ? 'failed' : 'pending';

  await supabase
    .from('aggregate_jobs')
    .update({
      status: newStatus,
      last_error: errorMessage,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .eq('status', 'processing');
}

// ─── Cancel ───────────────────────────────────────────────────────

/**
 * Cancel all pending/processing jobs for a game.
 * Called from `editGame` and `deleteGame` before synchronous rollback to prevent
 * double-counting if the game is edited before its aggregate job is processed.
 *
 * @returns The number of jobs cancelled.
 */
export async function cancelAggregateJobsForGame(gameId: string): Promise<number> {
  const { data, error } = await supabase.rpc('cancel_aggregate_jobs_for_game', {
    p_game_id: gameId,
  });

  if (error) {
    console.error('[aggregate-queue] Cancel error:', error);
    return 0;
  }

  return typeof data === 'number' ? data : 0;
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
