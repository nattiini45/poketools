import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockSupabase } from '@/lib/__tests__/helpers/supabase-mock';
import type { BattleStat, Game } from '@/types/game';
import type { PhaseAggregateJob } from '../phase-aggregate-storage';
import { lastSqlFunction } from '@/test/sql-functions';
import { phaseAggregateJobMachine, phaseGameAggregateMarkerMachine } from '../phase-aggregate-job-state';

vi.mock('@/lib/supabase/client', () => ({ supabase: createMockSupabase() }));
vi.mock('@/lib/supabase/queries/phase-games', () => ({ getPhaseGameById: vi.fn(), getPhaseBattleStatsByGame: vi.fn() }));
vi.mock('@/lib/revalidation', () => ({ expireSeasonReads: vi.fn(), revalidateMatchPages: vi.fn() }));

import { supabase } from '@/lib/supabase/client';
import { getPhaseGameById, getPhaseBattleStatsByGame } from '@/lib/supabase/queries/phase-games';
import { buildGameAggregateDeltas, getAggregates, getAggregatesSummary, clearAggregatesForScope } from '@/lib/supabase/queries/aggregates';
import { enqueueAggregateJob, processAggregateJobs, processAllAggregateJobs, AggregateQueueClaimError, AggregateQueueRunError } from '@/lib/match/aggregate-queue';
import * as phaseStorage from '../phase-aggregate-storage';
import {
  applyPhaseGameAggregatesNow, applyPhaseAggregateJob, cancelPhaseAggregateJobsForGame,
  processPhaseAggregateJobs, rollbackPhaseGameAggregates, requeueFailedPhaseIncrementJobsForSeason,
  getPhaseAggregateJobHealth,
} from '../phase-aggregate-storage';

const db = supabase as unknown as ReturnType<typeof createMockSupabase>;
const rpc = db.rpc as ReturnType<typeof vi.fn>;
const owner = { kind: 'phase' as const, phase_id: 'phase-1', season_id: 'season-1' };
const stats: BattleStat[] = [{
  id: 'stat-1', game_id: 'game-1', player_id: 'player-1', pokemon_name: 'Pikachu',
  was_brought: true, was_lead: true, kos_dealt: 2, was_koed: false,
  moves_used: ['Thunderbolt'], turns_active: 3, match_won: true, created_at: '',
}];
const job: PhaseAggregateJob = {
  id: 'job-1', game_id: 'game-1', phase_id: owner.phase_id, season_id: owner.season_id,
  match_id: 'match-1', operation: 'increment', status: 'processing', attempts: 1, max_attempts: 3,
  last_error: null, created_at: '', updated_at: '', processed_at: null,
};
const game: Game = {
  id: 'game-1', match_id: 'match-1', game_number: 1, winner_id: 'player-1', replay_url: '', replay_hash: null,
  source: 'manual', parsed: true, stats_locked: false, aggregate_applied_at: null,
  exclude_all_time: false, created_at: '', updated_at: '',
};

beforeEach(() => {
  vi.clearAllMocks();
  db.__setResult([]);
  vi.mocked(getPhaseGameById).mockResolvedValue(game);
  vi.mocked(getPhaseBattleStatsByGame).mockResolvedValue(stats);
});

describe('phase aggregate storage contracts', () => {
  it('shares delta algebra without manufacturing a tournament scope', () => {
    const native = buildGameAggregateDeltas(stats, owner);
    expect(native.aggregateDeltas.map((d) => [d.scope_type, d.scope_id])).toEqual([
      ['all_time', null], ['league', owner.season_id], ['phase', owner.phase_id],
    ]);
    const excluded = buildGameAggregateDeltas(stats, owner, { excludeAllTime: true });
    expect(excluded.playerDeltas.map((d) => d.scope_type)).toEqual(['league', 'phase']);
    expect(buildGameAggregateDeltas(stats, 't1', 's1')).toEqual(buildGameAggregateDeltas(stats,
      { kind: 'tournament', tournament_id: 't1', season_id: 's1' }));
    expect(native.aggregateDeltas.every((d) => d.appearances === 1 && d.kos_dealt === 2)).toBe(true);
  });

  it('preserves legacy enqueue and processing without touching native RPCs or tables', async () => {
    await enqueueAggregateJob('g1', 't1', null);
    expect(db.insert).toHaveBeenCalledWith({ game_id: 'g1', tournament_id: 't1', season_id: null, operation: 'increment', status: 'pending' });
    db.__setResult([]);
    await processAggregateJobs();
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['reclaim_stale_aggregate_jobs', 'claim_aggregate_jobs']);
    expect(db.from.mock.calls.map(([name]) => name)).toEqual(['aggregate_jobs']);
  });

  it('enqueues explicit phase owners with the native validated RPC', async () => {
    await enqueueAggregateJob('game-1', owner);
    expect(rpc).toHaveBeenCalledWith('enqueue_phase_aggregate_job', {
      p_game_id: 'game-1', p_phase_id: owner.phase_id, p_season_id: owner.season_id, p_processing: false,
    });
    expect(db.from).not.toHaveBeenCalled();
  });

  it('uses the atomic native apply for synchronous edits and validates outcome codes', async () => {
    const deltas = buildGameAggregateDeltas(stats, owner);
    rpc.mockResolvedValueOnce({ data: 'job-1', error: null }).mockResolvedValueOnce({ data: 'applied', error: null });
    await applyPhaseGameAggregatesNow('game-1', owner, deltas);
    expect(rpc).toHaveBeenLastCalledWith('apply_phase_aggregate_job', {
      p_game_id: 'game-1', p_job_id: 'job-1', p_aggregate_deltas: deltas.aggregateDeltas, p_player_deltas: deltas.playerDeltas,
    });
    rpc.mockResolvedValueOnce({ data: 'new-unknown-outcome', error: null });
    await expect(applyPhaseAggregateJob('job-1', 'game-1', deltas)).rejects.toThrow('unknown outcome');
  });

  it('cancel and rollback target only the native family', async () => {
    rpc.mockResolvedValueOnce({ data: 2, error: null });
    expect(await cancelPhaseAggregateJobsForGame('game-1')).toBe(2);
    rpc.mockResolvedValueOnce({ data: 'marker_changed', error: null });
    const deltas = buildGameAggregateDeltas(stats, owner);
    expect(await rollbackPhaseGameAggregates('game-1', 'marker', deltas)).toBe('marker_changed');
    expect(rpc).toHaveBeenLastCalledWith('rollback_phase_game_aggregates', {
      p_game_id: 'game-1', p_expected_applied_at: 'marker', p_aggregate_deltas: deltas.aggregateDeltas, p_player_deltas: deltas.playerDeltas,
    });
  });

  it('claims, computes frozen scopes and applies through the shared queue runner', async () => {
    vi.mocked(getPhaseGameById).mockResolvedValue({ ...game, exclude_all_time: true });
    rpc.mockResolvedValueOnce({ data: 1, error: null }).mockResolvedValueOnce({ data: [job], error: null })
      .mockResolvedValueOnce({ data: 'applied', error: null });
    const invalidate = vi.fn(async () => {});
    expect(await processPhaseAggregateJobs(5, invalidate)).toEqual({ processed: 1, failed: 0, reclaimed: 1 });
    expect(invalidate).toHaveBeenCalledWith(owner);
    expect(rpc).toHaveBeenLastCalledWith('apply_phase_aggregate_job', expect.objectContaining({
      p_aggregate_deltas: expect.arrayContaining([expect.objectContaining({ scope_type: 'phase' })]),
    }));
    const payload = rpc.mock.calls[2][1];
    expect(JSON.stringify(payload)).not.toContain('all_time');
    expect(db.from).not.toHaveBeenCalled();
  });

  it('propagates native claim and housekeeping failures rather than reporting success', async () => {
    const error = new Error('claim failed');
    rpc.mockResolvedValueOnce({ data: 0, error: null }).mockResolvedValueOnce({ data: null, error });
    await expect(processPhaseAggregateJobs()).rejects.toBeInstanceOf(AggregateQueueClaimError);
    rpc.mockResolvedValueOnce({ data: null, error }).mockResolvedValueOnce({ data: [], error: null });
    await expect(processPhaseAggregateJobs()).rejects.toBeInstanceOf(AggregateQueueRunError);
  });

  it('forwards the explicit mixed-worker phase invalidation hook', async () => {
    const hook = vi.fn(async () => {});
    const nativeWorker = vi.spyOn(phaseStorage, 'processPhaseAggregateJobs')
      .mockResolvedValue({ processed: 2, failed: 0, reclaimed: 1 });
    rpc.mockResolvedValueOnce({ data: 0, error: null }).mockResolvedValueOnce({ data: [], error: null });
    try {
      expect(await processAllAggregateJobs(7, hook)).toEqual({ processed: 2, failed: 0, reclaimed: 1 });
      expect(nativeWorker).toHaveBeenCalledWith(7, hook);
    } finally {
      nativeWorker.mockRestore();
    }
  });

  it('logs both rejected queue families with their original causes and preserves partial totals', async () => {
    const legacyFailure = new Error('legacy-reclaim-original-failure');
    const phaseFailure = new Error('phase-claim-original-failure');
    const phaseRun = new AggregateQueueRunError({ processed: 2, failed: 1, reclaimed: 3 }, [phaseFailure]);
    const nativeWorker = vi.spyOn(phaseStorage, 'processPhaseAggregateJobs').mockRejectedValue(phaseRun);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    rpc.mockResolvedValueOnce({ data: null, error: legacyFailure }).mockResolvedValueOnce({ data: [], error: null });
    try {
      const combined: unknown = await processAllAggregateJobs().catch((error: unknown) => error);
      expect(combined).toBeInstanceOf(AggregateQueueRunError);
      if (!(combined instanceof AggregateQueueRunError)) throw new Error('Expected a combined queue failure');
      expect(combined.result).toEqual({ processed: 2, failed: 1, reclaimed: 3 });
      expect(combined.cause).toBe(combined.errors[0]);
      expect(combined.errors[0]).toMatchObject({ cause: legacyFailure });
      expect(combined.errors[1]).toBe(phaseRun);
      expect(errorLog).toHaveBeenCalledWith(expect.stringMatching(/"family":"tournament".*legacy-reclaim-original-failure/));
      expect(errorLog).toHaveBeenCalledWith(expect.stringMatching(/"family":"phase".*phase-claim-original-failure/));
    } finally {
      nativeWorker.mockRestore();
      errorLog.mockRestore();
    }
  });

  it('guards a failed-job requeue on source state and checks native health', async () => {
    await requeueFailedPhaseIncrementJobsForSeason(owner.season_id);
    expect(db.eq).toHaveBeenCalledWith('status', 'failed');
    expect(db.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending', attempts: 0 }), { count: 'exact' });
    rpc.mockResolvedValueOnce({ data: [{ stranded_pending: 1, stale_processing: 2 }], error: null });
    expect(await getPhaseAggregateJobHealth()).toEqual({ strandedPending: 1, staleProcessing: 2 });
  });

  it('reads and clears phase projections without shared table access or move-count summary reads', async () => {
    await getAggregates('phase', owner.phase_id);
    expect(db.from).toHaveBeenCalledWith('phase_aggregates');
    vi.clearAllMocks();
    await getAggregatesSummary('phase', owner.phase_id);
    expect(db.select.mock.calls[0][0]).not.toContain('move_counts');
    await clearAggregatesForScope('phase', owner.phase_id);
    expect(db.from.mock.calls.every(([table]) => String(table).startsWith('phase_'))).toBe(true);
  });
});

describe('native aggregate state SQL fences', () => {
  it('shares the pure transition rules with dedicated native writers', () => {
    expect(phaseAggregateJobMachine.sourcesOf('cancelled')).toEqual(['pending', 'processing']);
    expect(phaseGameAggregateMarkerMachine.sourcesOf('counted')).toEqual(['uncounted']);
    const apply = lastSqlFunction('apply_phase_aggregate_job_inner').body;
    expect(apply).toContain("WHERE id = p_job_id AND status = 'processing'");
    expect(apply).toContain('FROM public.phase_games WHERE id = p_game_id FOR UPDATE');
    expect(apply.indexOf('public.phase_aggregate_deltas')).toBeLessThan(apply.indexOf('UPDATE public.phase_games SET aggregate_applied_at'));
    const rollback = lastSqlFunction('rollback_phase_game_aggregates_inner').body;
    expect(rollback).toContain('FOR UPDATE OF g');
    expect(rollback).toContain('v_applied_at IS DISTINCT FROM p_expected_applied_at');
    expect(lastSqlFunction('claim_phase_aggregate_jobs_inner').body).toContain('FOR UPDATE SKIP LOCKED');
  });
});
