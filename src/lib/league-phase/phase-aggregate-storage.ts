import { supabase } from '@/lib/supabase/client';
import { readBoundedPages } from '@/lib/supabase/read-bounded-pages';
import { getPhaseGameById, getPhaseBattleStatsByGame } from '@/lib/supabase/queries/phase-games';
import {
  buildGameAggregateDeltas,
  type GameAggregateDeltas,
  type ApplyAggregateJobOutcome,
  type RollbackGameAggregatesOutcome,
} from '@/lib/supabase/queries/aggregates';
import {
  AggregateQueueWriteError,
  SyncAggregateApplyConflictError,
  runAggregateQueue,
  type AggregateJobHealth,
  type AggregateJobStats,
} from '@/lib/match/aggregate-queue';
import { phaseAggregateJobMachine } from './phase-aggregate-job-state';
import {
  AggregateRebuildInProgressError,
  isAggregateRebuildFence,
} from '@/lib/supabase/queries/aggregate-rebuild-lock';
import { expireSeasonReads } from '@/lib/revalidation';
import { isLiveIncrementJob } from '@/lib/supabase/queries/games';
import type { CompetitionOwner } from '@/types/competition-owner';
import type { Json, Tables } from '@/types/database';
import type { AggregateScope } from '@/types/game';

export type PhaseAggregateOwner = Extract<CompetitionOwner, { kind: 'phase' }>;
export type PhaseAggregateJob = Tables<'phase_aggregate_jobs'>;

async function createJob(gameId: string, owner: PhaseAggregateOwner, processing: boolean): Promise<string> {
  const { data, error } = await supabase.rpc('enqueue_phase_aggregate_job', {
    p_game_id: gameId, p_phase_id: owner.phase_id, p_season_id: owner.season_id, p_processing: processing,
  });
  if (error) throw error;
  return data;
}

export async function enqueuePhaseAggregateJob(gameId: string, owner: PhaseAggregateOwner): Promise<void> {
  await createJob(gameId, owner, false);
}

export async function cancelPhaseAggregateJobsForGame(gameId: string): Promise<number> {
  const { data, error } = await supabase.rpc('cancel_phase_aggregate_jobs_for_game', { p_game_id: gameId });
  if (error) throw error;
  return data;
}

export async function applyPhaseAggregateJob(jobId: string, gameId: string, deltas: GameAggregateDeltas): Promise<ApplyAggregateJobOutcome> {
  const { data, error } = await supabase.rpc('apply_phase_aggregate_job', {
    p_job_id: jobId, p_game_id: gameId,
    p_aggregate_deltas: deltas.aggregateDeltas as unknown as Json,
    p_player_deltas: deltas.playerDeltas as unknown as Json,
  });
  if (error) {
    if (isAggregateRebuildFence(error)) throw new AggregateRebuildInProgressError(error);
    throw error;
  }
  switch (data) {
    case 'applied': case 'already_applied': case 'game_missing': case 'job_not_processing': return data;
    default: throw new Error(`apply_phase_aggregate_job returned an unknown outcome: ${JSON.stringify(data)}`);
  }
}

export async function applyPhaseGameAggregatesNow(gameId: string, owner: PhaseAggregateOwner, deltas: GameAggregateDeltas): Promise<void> {
  const id = await createJob(gameId, owner, true);
  const outcome = await applyPhaseAggregateJob(id, gameId, deltas);
  if (outcome !== 'applied') throw new SyncAggregateApplyConflictError(gameId, outcome);
}

export async function rollbackPhaseGameAggregates(gameId: string, expectedAppliedAt: string, deltas: GameAggregateDeltas): Promise<RollbackGameAggregatesOutcome> {
  const { data, error } = await supabase.rpc('rollback_phase_game_aggregates', {
    p_game_id: gameId, p_expected_applied_at: expectedAppliedAt,
    p_aggregate_deltas: deltas.aggregateDeltas as unknown as Json,
    p_player_deltas: deltas.playerDeltas as unknown as Json,
  });
  if (error) {
    if (isAggregateRebuildFence(error)) throw new AggregateRebuildInProgressError(error);
    throw error;
  }
  switch (data) {
    case 'rolled_back': case 'not_applied': case 'marker_changed': case 'game_missing': return data;
    default: throw new Error(`rollback_phase_game_aggregates returned an unknown outcome: ${JSON.stringify(data)}`);
  }
}

async function completeJob(id: string): Promise<void> {
  phaseAggregateJobMachine.assertTransition('processing', 'completed', 'queue');
  const now = new Date().toISOString();
  const { error } = await supabase.from('phase_aggregate_jobs')
    .update({ status: 'completed', processed_at: now, updated_at: now }).eq('id', id).eq('status', 'processing');
  if (error) throw new AggregateQueueWriteError(`Failed to complete phase aggregate job ${id}`, { cause: error });
}

async function failJob(id: string, message: string): Promise<void> {
  const { data, error } = await supabase.from('phase_aggregate_jobs').select('attempts, max_attempts')
    .eq('id', id).eq('status', 'processing').maybeSingle();
  if (error) throw new AggregateQueueWriteError(`Failed to read phase aggregate job ${id}`, { cause: error });
  if (!data) return;
  const status = data.attempts >= data.max_attempts ? 'failed' : 'pending';
  phaseAggregateJobMachine.assertTransition('processing', status, 'queue');
  const result = await supabase.from('phase_aggregate_jobs')
    .update({ status, last_error: message, updated_at: new Date().toISOString() }).eq('id', id).eq('status', 'processing');
  if (result.error) throw new AggregateQueueWriteError(`Failed to retry phase aggregate job ${id}`, { cause: result.error });
}

export async function processPhaseAggregateJobs(limit = 20, onApplied?: (owner: PhaseAggregateOwner) => Promise<void>) {
  return runAggregateQueue<PhaseAggregateJob>(limit, {
    reclaim: () => supabase.rpc('reclaim_stale_phase_aggregate_jobs'),
    claim: (batchSize) => supabase.rpc('claim_phase_aggregate_jobs', { p_limit: batchSize }),
    process: async (job) => {
      const game = await getPhaseGameById(job.game_id);
      if (!game || game.aggregate_applied_at) {
        await completeJob(job.id);
        return false;
      }
      const stats = await getPhaseBattleStatsByGame(job.game_id);
      if (stats.length === 0) {
        await completeJob(job.id);
        return false;
      }
      if (job.operation !== 'increment') throw new Error(`Unsupported operation: ${job.operation}`);
      const deltas = buildGameAggregateDeltas(stats, { kind: 'phase', phase_id: job.phase_id, season_id: job.season_id },
        { excludeAllTime: game.exclude_all_time });
      return await applyPhaseAggregateJob(job.id, job.game_id, deltas) === 'applied';
    },
    fail: failJob,
    revalidate: async (jobs) => {
      const owners = new Map(jobs.map((job) => [job.phase_id, { kind: 'phase' as const, phase_id: job.phase_id, season_id: job.season_id }]));
      for (const owner of owners.values()) {
        expireSeasonReads(owner.season_id);
        if (onApplied) await onApplied(owner);
      }
    },
  });
}

export async function getPhaseAggregateJobHealth(): Promise<AggregateJobHealth> {
  const { data, error } = await supabase.rpc('phase_aggregate_job_health');
  if (error) throw error;
  const row = data[0];
  if (!row) throw new Error('phase_aggregate_job_health returned no row');
  return { strandedPending: row.stranded_pending, staleProcessing: row.stale_processing };
}

export async function getPhaseAggregateJobStats(): Promise<AggregateJobStats> {
  const statuses = phaseAggregateJobMachine.spec.states;
  const counts: AggregateJobStats = { pending: 0, processing: 0, completed: 0, failed: 0, cancelled: 0 };
  const results = await Promise.all(statuses.map((status) => supabase.from('phase_aggregate_jobs')
    .select('id', { count: 'exact', head: true }).eq('status', status)));
  results.forEach(({ count, error }, i) => {
    if (error) throw error;
    if (count === null) throw new Error('phase_aggregate_jobs returned no exact count');
    counts[statuses[i]] = count;
  });
  return counts;
}

export async function countFailedPhaseIncrementJobsForSeason(seasonId: string): Promise<number> {
  const { count, error } = await supabase.from('phase_aggregate_jobs').select('id', { count: 'exact', head: true })
    .eq('season_id', seasonId).eq('operation', 'increment').eq('status', 'failed');
  if (error) throw error;
  if (count === null) throw new Error('phase_aggregate_jobs returned no exact count');
  return count;
}

export async function countFailedPhaseAggregateJobs(): Promise<number> {
  const { count, error } = await supabase.from('phase_aggregate_jobs')
    .select('id', { count: 'exact', head: true }).eq('status', 'failed');
  if (error) throw error;
  if (count === null) throw new Error('phase_aggregate_jobs returned no exact count');
  return count;
}

export async function requeueFailedPhaseIncrementJobsForSeason(seasonId: string): Promise<number> {
  phaseAggregateJobMachine.assertTransition('failed', 'pending', 'admin');
  const { count, error } = await supabase.from('phase_aggregate_jobs')
    .update({ status: 'pending', attempts: 0, last_error: null, updated_at: new Date().toISOString() }, { count: 'exact' })
    .eq('season_id', seasonId).eq('operation', 'increment').eq('status', 'failed');
  if (error) throw new AggregateQueueWriteError(`Failed to requeue phase jobs of season ${seasonId}`, { cause: error });
  return count ?? 0;
}

export async function listPhaseGameIdsWithLiveIncrementJobs(): Promise<Set<string>> {
  const { rows, truncated } = await readBoundedPages((from, to) => supabase.from('phase_aggregate_jobs')
    .select('game_id, operation, status, attempts, max_attempts').eq('operation', 'increment')
    .in('status', ['pending', 'processing']).order('id').range(from, to), { label: 'phase live aggregate jobs' });
  if (truncated) throw new Error('Phase live aggregate job read exceeded its bound');
  return new Set(rows.filter(isLiveIncrementJob).map((row) => row.game_id));
}

export async function getNewestPhaseGameCreatedAt(): Promise<string | null> {
  const { data, error } = await supabase.from('phase_games').select('created_at')
    .order('created_at', { ascending: false }).order('id').limit(1).maybeSingle();
  if (error) throw error;
  return data?.created_at ?? null;
}

export async function getPhaseAggregateSeasonId(phaseId: string): Promise<string | null> {
  const { data, error } = await supabase.from('league_phases').select('season_id').eq('id', phaseId).maybeSingle();
  if (error) throw error;
  return data?.season_id ?? null;
}

export async function listPhaseGamesForAggregateRebuild(scopeType: AggregateScope, scopeId: string | null,
  offset: number, limit: number, createdUpTo: string | null) {
  if (scopeType === 'tournament' || createdUpTo === null) return [];
  if (scopeType !== 'all_time' && !scopeId) throw new Error('scope_id required for phase and league rebuilds');
  let query = supabase.from('phase_games').select(`id, exclude_all_time,
    phase_matches!inner (phase_id, status, league_phases!inner (season_id)),
    phase_aggregate_jobs (operation, status, attempts, max_attempts)`)
    .neq('phase_matches.status', 'scheduled').lte('created_at', createdUpTo)
    .order('id').range(offset, offset + limit - 1);
  if (scopeType === 'phase') query = query.eq('phase_matches.phase_id', scopeId!);
  if (scopeType === 'league') query = query.eq('phase_matches.league_phases.season_id', scopeId!);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => ({
    game_id: row.id, phase_id: row.phase_matches.phase_id,
    season_id: row.phase_matches.league_phases.season_id,
    exclude_all_time: row.exclude_all_time,
    live_increment_job: row.phase_aggregate_jobs.some(isLiveIncrementJob),
  }));
}
