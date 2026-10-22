import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockSupabase } from '@/lib/__tests__/helpers/supabase-mock';
import type { BattleStat, Game } from '@/types/game';

vi.mock('@/lib/supabase/client', () => ({
  supabase: createMockSupabase(),
}));

vi.mock('@/lib/supabase/queries/games', () => ({
  getGameById: vi.fn(),
  getBattleStatsByGame: vi.fn(),
}));

vi.mock('@/lib/revalidation', () => ({
  revalidateMatchPages: vi.fn(),
}));

// The real aggregates module: its apply wrapper goes through the mocked
// client's rpc, so these tests see the exact apply_aggregate_job payload.
import { supabase } from '@/lib/supabase/client';
import { getBattleStatsByGame, getGameById } from '@/lib/supabase/queries/games';
import { revalidateMatchPages } from '@/lib/revalidation';
import { buildGameAggregateDeltas } from '@/lib/supabase/queries/aggregates';
import {
  AggregateQueueClaimError,
  AggregateQueueRunError,
  SyncAggregateApplyConflictError,
  applyGameAggregatesNow,
  enqueueAggregateJob,
  processAggregateJobs,
  cancelAggregateJobsForGame,
  getAggregateJobHealth,
  getAggregateJobStats,
  type AggregateJob,
} from '../aggregate-queue';

// ─── Helpers ────────────────────────────────────────────────────────

const mockSupabase = supabase as unknown as ReturnType<typeof createMockSupabase> & { rpc: ReturnType<typeof vi.fn> };
const mockRpc = mockSupabase.rpc;

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: 'game-1',
    match_id: 'match-1',
    game_number: 1,
    winner_id: 'player-1',
    replay_url: '',
    replay_hash: null,
    source: 'manual',
    parsed: true,
    stats_locked: false,
    aggregate_applied_at: null,
    exclude_all_time: false,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

function makeStat(overrides: Partial<BattleStat> = {}): BattleStat {
  return {
    id: 'stat-1',
    game_id: 'game-1',
    player_id: 'player-1',
    pokemon_name: 'Pikachu',
    was_brought: true,
    was_lead: true,
    kos_dealt: 1,
    was_koed: false,
    moves_used: ['Thunderbolt'],
    turns_active: 5,
    match_won: true,
    created_at: '',
    ...overrides,
  };
}

function makeJob(overrides: Partial<AggregateJob> = {}): AggregateJob {
  return {
    id: 'job-1',
    game_id: 'game-1',
    tournament_id: 'tourney-1',
    season_id: null,
    operation: 'increment',
    status: 'processing',
    attempts: 1,
    max_attempts: 3,
    last_error: null,
    created_at: '',
    updated_at: '',
    processed_at: null,
    ...overrides,
  };
}

/** reclaim → claim → (apply outcome) */
function queueRun(jobs: AggregateJob[], ...applyResults: Array<{ data: unknown; error: unknown }>) {
  mockRpc
    .mockResolvedValueOnce({ data: 0, error: null })
    .mockResolvedValueOnce({ data: jobs, error: null });
  for (const r of applyResults) mockRpc.mockResolvedValueOnce(r);
}

function rpcCalls(name: string): unknown[][] {
  return mockRpc.mock.calls.filter((call) => call[0] === name);
}

function updatePayloads(): Record<string, unknown>[] {
  return (mockSupabase.update as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0] as Record<string, unknown>);
}

// ─── enqueueAggregateJob ──────────────────────────────────────────

describe('enqueueAggregateJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase.__reset();
  });

  it('calls supabase.from with aggregate_jobs', async () => {
    await enqueueAggregateJob('game-1', 'tourney-1', null);

    expect(mockSupabase.from).toHaveBeenCalledWith('aggregate_jobs');
  });
});

// ─── applyGameAggregatesNow (editGame re-apply) ────────────────────

describe('applyGameAggregatesNow', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  const deltas = buildGameAggregateDeltas([makeStat()], 'tourney-1', 'season-1', { excludeAllTime: false });

  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockReset();
    mockRpc.mockReturnValue(mockSupabase);
    mockSupabase.__reset();
    mockSupabase.__setResult([{ id: 'sync-job-1' }]);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('inserts an already-processing job and applies increments + marker in ONE apply_aggregate_job call', async () => {
    mockRpc.mockResolvedValueOnce({ data: 'applied', error: null });

    await applyGameAggregatesNow('game-1', 'tourney-1', 'season-1', deltas);

    expect(mockSupabase.from).toHaveBeenCalledWith('aggregate_jobs');
    expect(mockSupabase.insert).toHaveBeenCalledWith({
      game_id: 'game-1',
      tournament_id: 'tourney-1',
      season_id: 'season-1',
      operation: 'increment',
      status: 'processing',
      attempts: 1,
    });
    const applyCalls = rpcCalls('apply_aggregate_job');
    expect(applyCalls).toHaveLength(1);
    expect(applyCalls[0][1]).toEqual({
      p_job_id: 'sync-job-1',
      p_game_id: 'game-1',
      p_aggregate_deltas: deltas.aggregateDeltas,
      p_player_deltas: deltas.playerDeltas,
    });
    // No separate increment RPCs and no separate marker write on games.
    expect(rpcCalls('batch_upsert_aggregates')).toHaveLength(0);
    expect(rpcCalls('batch_upsert_player_aggregates')).toHaveLength(0);
    expect(mockSupabase.from).not.toHaveBeenCalledWith('games');
    expect(mockSupabase.update).not.toHaveBeenCalled();
  });

  it('throws the apply RPC error without writing the marker on its own (nothing committed)', async () => {
    const err = { message: 'canceling statement due to statement timeout' };
    mockRpc.mockResolvedValueOnce({ data: null, error: err });

    await expect(applyGameAggregatesNow('game-1', 'tourney-1', 'season-1', deltas)).rejects.toBe(err);

    expect(mockSupabase.from).not.toHaveBeenCalledWith('games');
    expect(mockSupabase.update).not.toHaveBeenCalled();
  });

  it('throws and never calls the apply RPC when the job insert fails', async () => {
    const err = new Error('insert failed');
    mockSupabase.__setError(err);

    await expect(applyGameAggregatesNow('game-1', 'tourney-1', null, deltas)).rejects.toBe(err);

    expect(rpcCalls('apply_aggregate_job')).toHaveLength(0);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it.each(['already_applied', 'game_missing', 'job_not_processing'] as const)(
    'throws SyncAggregateApplyConflictError when the apply reports %s',
    async (outcome) => {
      mockRpc.mockResolvedValueOnce({ data: outcome, error: null });

      const promise = applyGameAggregatesNow('game-1', 'tourney-1', null, deltas);
      await expect(promise).rejects.toBeInstanceOf(SyncAggregateApplyConflictError);
      await expect(promise).rejects.toMatchObject({ outcome });
    },
  );

  it('throws on an unknown apply outcome instead of assuming success', async () => {
    mockRpc.mockResolvedValueOnce({ data: 'mystery', error: null });

    await expect(applyGameAggregatesNow('game-1', 'tourney-1', null, deltas)).rejects.toThrow(
      /unknown outcome/,
    );
  });
});

// ─── processAggregateJobs ──────────────────────────────────────────

describe('processAggregateJobs', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockReset();
    mockRpc.mockReturnValue(mockSupabase);
    mockSupabase.__reset();
    vi.mocked(getGameById).mockResolvedValue(makeGame());
    vi.mocked(getBattleStatsByGame).mockResolvedValue([makeStat()]);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('reclaims stale jobs before claiming new ones', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: 2, error: null })
      .mockResolvedValueOnce({ data: [], error: null });

    const result = await processAggregateJobs(20);

    expect(result).toEqual({ processed: 0, failed: 0, reclaimed: 2 });
    expect(mockRpc.mock.calls[0]).toEqual(['reclaim_stale_aggregate_jobs']);
  });

  it('returns early when no jobs are claimed', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: 0, error: null })
      .mockResolvedValueOnce({ data: null, error: null });

    const result = await processAggregateJobs(20);

    expect(result).toEqual({ processed: 0, failed: 0, reclaimed: 0 });
    expect(getGameById).not.toHaveBeenCalled();
  });

  it('calls claim_aggregate_jobs RPC with the limit', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: 0, error: null })
      .mockResolvedValueOnce({ data: [], error: null });

    await processAggregateJobs(10);

    expect(mockRpc).toHaveBeenCalledWith('claim_aggregate_jobs', { p_limit: 10 });
  });

  it('logs and throws when the claim RPC fails, processing nothing (H6)', async () => {
    const claimError = { message: 'RPC error', code: '22P02' };
    mockRpc
      .mockResolvedValueOnce({ data: 0, error: null })
      .mockResolvedValueOnce({ data: null, error: claimError });

    const run = processAggregateJobs(20);
    await expect(run).rejects.toBeInstanceOf(AggregateQueueClaimError);
    const err = (await run.catch((e: unknown) => e)) as AggregateQueueClaimError;
    expect(err.cause).toBe(claimError);
    expect(consoleErrorSpy).toHaveBeenCalledWith('[aggregate-queue] Claim error:', claimError);
    expect(getGameById).not.toHaveBeenCalled();
    expect(rpcCalls('apply_aggregate_job')).toHaveLength(0);
  });

  it('logs a reclaim error, still applies freshly claimed jobs, then rejects the run', async () => {
    const reclaimError = { message: 'reclaim down' };
    mockRpc
      .mockResolvedValueOnce({ data: null, error: reclaimError })
      .mockResolvedValueOnce({ data: [makeJob()], error: null })
      .mockResolvedValueOnce({ data: 'applied', error: null });

    const run = processAggregateJobs(20);

    await expect(run).rejects.toBeInstanceOf(AggregateQueueRunError);
    const err = (await run.catch((e: unknown) => e)) as AggregateQueueRunError;
    expect(err.cause).toBe(reclaimError);
    expect(err.errors).toEqual([reclaimError]);
    expect(err.result).toEqual({ processed: 1, failed: 0, reclaimed: 0 });
    expect(consoleErrorSpy).toHaveBeenCalledWith('[aggregate-queue] Reclaim error:', reclaimError);
    expect(rpcCalls('apply_aggregate_job')).toHaveLength(1);
    // Applied aggregates are still revalidated before the run fails.
    expect(revalidateMatchPages).toHaveBeenCalledWith('tourney-1');
  });

  it('applies a claimed job through ONE apply_aggregate_job call, with no separate marker write', async () => {
    queueRun([makeJob()], { data: 'applied', error: null });

    const result = await processAggregateJobs(20);

    expect(result).toEqual({ processed: 1, failed: 0, reclaimed: 0 });
    const applyCalls = rpcCalls('apply_aggregate_job');
    expect(applyCalls).toHaveLength(1);
    const args = applyCalls[0][1] as {
      p_job_id: string;
      p_game_id: string;
      p_aggregate_deltas: Array<{ scope_type: string; scope_id: string | null; pokemon_name: string }>;
      p_player_deltas: Array<{ scope_type: string; player_id: string }>;
    };
    expect(args.p_job_id).toBe('job-1');
    expect(args.p_game_id).toBe('game-1');
    expect(args.p_aggregate_deltas.map((d) => [d.scope_type, d.scope_id])).toEqual([
      ['all_time', null],
      ['tournament', 'tourney-1'],
    ]);
    expect(args.p_player_deltas).toHaveLength(2);
    // The old path's separate writes are gone: no batch_upsert_* RPC and no games update.
    expect(rpcCalls('batch_upsert_aggregates')).toHaveLength(0);
    expect(rpcCalls('batch_upsert_player_aggregates')).toHaveLength(0);
    expect(mockSupabase.from).not.toHaveBeenCalledWith('games');
    // The RPC completed the job; the queue writes no completion of its own.
    expect(mockSupabase.update).not.toHaveBeenCalled();
    expect(revalidateMatchPages).toHaveBeenCalledWith('tourney-1');
  });

  it('builds deltas without the all_time scope for an excluded game, and with the league scope', async () => {
    vi.mocked(getGameById).mockResolvedValueOnce(makeGame({ exclude_all_time: true }));
    queueRun([makeJob({ season_id: 'season-1' })], { data: 'applied', error: null });

    await processAggregateJobs(20);

    const args = rpcCalls('apply_aggregate_job')[0][1] as {
      p_aggregate_deltas: Array<{ scope_type: string; scope_id: string | null }>;
    };
    expect(args.p_aggregate_deltas.map((d) => [d.scope_type, d.scope_id])).toEqual([
      ['league', 'season-1'],
      ['tournament', 'tourney-1'],
    ]);
  });

  it.each(['already_applied', 'game_missing', 'job_not_processing'])(
    'treats the %s outcome as handled without revalidating or failing the job',
    async (outcome) => {
      queueRun([makeJob()], { data: outcome, error: null });

      const result = await processAggregateJobs(20);

      expect(result).toEqual({ processed: 1, failed: 0, reclaimed: 0 });
      expect(revalidateMatchPages).not.toHaveBeenCalled();
      expect(mockSupabase.update).not.toHaveBeenCalled();
    },
  );

  it('fails the job (retriable) on an unknown apply outcome instead of assuming success', async () => {
    mockSupabase.__setResult([{ attempts: 1, max_attempts: 3 }]);
    queueRun([makeJob()], { data: 'surprise', error: null });

    const result = await processAggregateJobs(20);

    expect(result).toEqual({ processed: 0, failed: 1, reclaimed: 0 });
    expect(revalidateMatchPages).not.toHaveBeenCalled();
    expect(updatePayloads()).toEqual([
      expect.objectContaining({
        status: 'pending',
        last_error: expect.stringContaining('unknown outcome'),
      }),
    ]);
  });

  it('returns a job whose apply RPC failed to pending, and the run still resolves (retriable)', async () => {
    mockSupabase.__setResult([{ attempts: 1, max_attempts: 3 }]);
    queueRun([makeJob()], { data: null, error: { message: 'deadlock detected' } });

    const result = await processAggregateJobs(20);

    expect(result).toEqual({ processed: 0, failed: 1, reclaimed: 0 });
    expect(consoleErrorSpy).toHaveBeenCalledWith('[aggregate-queue] Job job-1 failed:', { message: 'deadlock detected' });
    expect(updatePayloads()).toEqual([
      expect.objectContaining({ status: 'pending', last_error: 'deadlock detected' }),
    ]);
    expect(mockSupabase.eq).toHaveBeenCalledWith('status', 'processing');
  });

  it('marks a job failed for good once its attempts are exhausted', async () => {
    mockSupabase.__setResult([{ attempts: 3, max_attempts: 3 }]);
    queueRun([makeJob({ attempts: 3 })], { data: null, error: { message: 'boom' } });

    await processAggregateJobs(20);

    expect(updatePayloads()).toEqual([expect.objectContaining({ status: 'failed', last_error: 'boom' })]);
  });

  it('leaves a job alone when it is no longer processing (cancelled meanwhile)', async () => {
    mockSupabase.__setResult([]); // maybeSingle → null: zero rows is not an error
    queueRun([makeJob()], { data: null, error: { message: 'boom' } });

    const result = await processAggregateJobs(20);

    expect(result.failed).toBe(1);
    expect(mockSupabase.maybeSingle).toHaveBeenCalled();
    expect(mockSupabase.update).not.toHaveBeenCalled();
  });

  it('rejects the run when a failed job cannot be returned to the queue', async () => {
    const readError = new Error('select failed');
    mockSupabase.__setError(readError);
    queueRun([makeJob()], { data: null, error: { message: 'boom' } });

    const run = processAggregateJobs(20);

    await expect(run).rejects.toBeInstanceOf(AggregateQueueRunError);
    const err = (await run.catch((e: unknown) => e)) as AggregateQueueRunError;
    expect(err.result).toEqual({ processed: 0, failed: 1, reclaimed: 0 });
    expect((err.cause as Error).cause).toBe(readError);
    expect(consoleErrorSpy).toHaveBeenCalledWith('[aggregate-queue] Mark-failed read error for job job-1:', readError);
  });

  it('rejects the run when the mark-failed update errors', async () => {
    mockSupabase.__setResult([{ attempts: 1, max_attempts: 3 }]);
    const updateError = new Error('update failed');
    // The read resolves through maybeSingle; the update resolves through then.
    (mockSupabase.then as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (resolve: (value: unknown) => void) => resolve({ data: null, error: updateError }),
    );
    queueRun([makeJob()], { data: null, error: { message: 'boom' } });

    await expect(processAggregateJobs(20)).rejects.toBeInstanceOf(AggregateQueueRunError);
    expect(consoleErrorSpy).toHaveBeenCalledWith('[aggregate-queue] Mark-failed update error for job job-1:', updateError);
  });

  it('completes the job without applying when the game no longer exists', async () => {
    vi.mocked(getGameById).mockResolvedValueOnce(null);
    queueRun([makeJob()]);

    const result = await processAggregateJobs(20);

    expect(result).toEqual({ processed: 1, failed: 0, reclaimed: 0 });
    expect(rpcCalls('apply_aggregate_job')).toHaveLength(0);
    expect(updatePayloads()).toEqual([expect.objectContaining({ status: 'completed' })]);
    expect(mockSupabase.eq).toHaveBeenCalledWith('status', 'processing');
  });

  it('completes the job without applying when the game has no battle stats', async () => {
    vi.mocked(getBattleStatsByGame).mockResolvedValueOnce([]);
    queueRun([makeJob()]);

    const result = await processAggregateJobs(20);

    expect(result.processed).toBe(1);
    expect(rpcCalls('apply_aggregate_job')).toHaveLength(0);
    expect(updatePayloads()).toEqual([expect.objectContaining({ status: 'completed' })]);
  });

  it('skips aggregate updates for already-applied games', async () => {
    vi.mocked(getGameById).mockResolvedValueOnce(makeGame({ aggregate_applied_at: '2026-05-21T00:00:00Z' }));
    queueRun([makeJob()]);

    const result = await processAggregateJobs(20);

    expect(result.processed).toBe(1);
    expect(rpcCalls('apply_aggregate_job')).toHaveLength(0);
    expect(revalidateMatchPages).not.toHaveBeenCalled();
  });

  it('rejects the run when completing a job fails, after returning it to the queue', async () => {
    vi.mocked(getGameById).mockResolvedValueOnce(null);
    const completeError = new Error('complete failed');
    (mockSupabase.then as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (resolve: (value: unknown) => void) => resolve({ data: null, error: completeError }),
    );
    mockSupabase.__setResult([{ attempts: 1, max_attempts: 3 }]);
    queueRun([makeJob()]);

    const run = processAggregateJobs(20);

    await expect(run).rejects.toBeInstanceOf(AggregateQueueRunError);
    const err = (await run.catch((e: unknown) => e)) as AggregateQueueRunError;
    expect(err.result.failed).toBe(1);
    expect((err.cause as Error).cause).toBe(completeError);
    expect(consoleErrorSpy).toHaveBeenCalledWith('[aggregate-queue] Complete error for job job-1:', completeError);
    // The job was returned to pending so a later run retries it.
    expect(updatePayloads()).toEqual([
      expect.objectContaining({ status: 'completed' }),
      expect.objectContaining({ status: 'pending' }),
    ]);
  });

  it('fails an unsupported operation as a retriable job failure', async () => {
    mockSupabase.__setResult([{ attempts: 1, max_attempts: 3 }]);
    queueRun([makeJob({ operation: 'decrement' })]);

    const result = await processAggregateJobs(20);

    expect(result).toEqual({ processed: 0, failed: 1, reclaimed: 0 });
    expect(rpcCalls('apply_aggregate_job')).toHaveLength(0);
  });

  it('keeps processing the batch after one job fails', async () => {
    mockSupabase.__setResult([{ attempts: 1, max_attempts: 3 }]);
    queueRun(
      [makeJob(), makeJob({ id: 'job-2', game_id: 'game-2', tournament_id: 'tourney-2' })],
      { data: null, error: { message: 'boom' } },
      { data: 'applied', error: null },
    );

    const result = await processAggregateJobs(20);

    expect(result).toEqual({ processed: 1, failed: 1, reclaimed: 0 });
    expect(revalidateMatchPages).toHaveBeenCalledTimes(1);
    expect(revalidateMatchPages).toHaveBeenCalledWith('tourney-2');
  });

});

// ─── cancelAggregateJobsForGame ───────────────────────────────────

describe('cancelAggregateJobsForGame', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockReset();
    mockRpc.mockReturnValue(mockSupabase);
  });

  it('calls the cancel RPC with the game_id', async () => {
    mockRpc.mockResolvedValueOnce({ data: 3, error: null });

    const result = await cancelAggregateJobsForGame('game-1');

    expect(mockRpc).toHaveBeenCalledWith('cancel_aggregate_jobs_for_game', {
      p_game_id: 'game-1',
    });
    expect(result).toBe(3);
  });

  it('throws on RPC error so edit/delete abort before touching aggregates', async () => {
    const cancelError = { message: 'Cancel failed' };
    mockRpc.mockResolvedValueOnce({ data: null, error: cancelError });

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(cancelAggregateJobsForGame('game-1')).rejects.toBe(cancelError);
    expect(consoleErrorSpy).toHaveBeenCalledWith('[aggregate-queue] Cancel error:', cancelError);
    consoleErrorSpy.mockRestore();
  });

  it('returns 0 when there was nothing to cancel', async () => {
    mockRpc.mockResolvedValueOnce({ data: 0, error: null });

    await expect(cancelAggregateJobsForGame('game-1')).resolves.toBe(0);
  });
});

// ─── getAggregateJobHealth ────────────────────────────────────────

describe('getAggregateJobHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockReset();
    mockRpc.mockReturnValue(mockSupabase);
  });

  it('maps the health row', async () => {
    mockRpc.mockResolvedValueOnce({ data: [{ stranded_pending: 2, stale_processing: 1 }], error: null });

    await expect(getAggregateJobHealth()).resolves.toEqual({ strandedPending: 2, staleProcessing: 1 });
    expect(mockRpc).toHaveBeenCalledWith('aggregate_job_health');
  });

  it('throws and logs when the probe fails', async () => {
    const healthError = { message: 'probe failed' };
    mockRpc.mockResolvedValueOnce({ data: null, error: healthError });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(getAggregateJobHealth()).rejects.toBe(healthError);
    expect(consoleErrorSpy).toHaveBeenCalledWith('[aggregate-queue] Health check error:', healthError);
    consoleErrorSpy.mockRestore();
  });

  it('throws instead of reporting a healthy queue when the probe returns no row', async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null });

    await expect(getAggregateJobHealth()).rejects.toThrow('aggregate_job_health returned no row');
  });
});

// ─── getAggregateJobStats ─────────────────────────────────────────

describe('getAggregateJobStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase.__reset();
  });

  it('throws when a count query fails instead of reporting zeros', async () => {
    mockSupabase.__setError(new Error('Select error'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Zeros would tell the drain loop the queue is empty and stop it early.
    await expect(getAggregateJobStats()).rejects.toThrow('Select error');
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[aggregate-queue] Job count failed'),
      expect.any(Error),
    );

    errorSpy.mockRestore();
  });
});
