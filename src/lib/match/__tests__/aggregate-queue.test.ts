import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockSupabase } from '@/lib/__tests__/helpers/supabase-mock';

vi.mock('@/lib/supabase/client', () => ({
  supabase: createMockSupabase(),
}));

vi.mock('@/lib/supabase/queries/games', () => ({
  getGameById: vi.fn(),
  getBattleStatsByGame: vi.fn(),
  markGameAggregatesApplied: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/aggregates', () => ({
  updateAggregates: vi.fn(),
}));

vi.mock('@/lib/revalidation', () => ({
  revalidateMatchPages: vi.fn(),
}));

import { supabase } from '@/lib/supabase/client';
import { updateAggregates } from '@/lib/supabase/queries/aggregates';
import { getBattleStatsByGame, getGameById, markGameAggregatesApplied } from '@/lib/supabase/queries/games';
import { revalidateMatchPages } from '@/lib/revalidation';
import {
  enqueueAggregateJob,
  processAggregateJobs,
  cancelAggregateJobsForGame,
  getAggregateJobStats,
} from '../aggregate-queue';

// ─── Helpers ────────────────────────────────────────────────────────

const mockSupabase = supabase as unknown as ReturnType<typeof createMockSupabase> & { rpc: ReturnType<typeof vi.fn> };
const mockRpc = mockSupabase.rpc;

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

// ─── processAggregateJobs ──────────────────────────────────────────

describe('processAggregateJobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase.__reset();
    vi.mocked(getGameById).mockResolvedValue({
      id: 'game-1',
      match_id: 'match-1',
      game_number: 1,
      winner_id: 'player-1',
      replay_url: '',
      source: 'manual',
      parsed: true,
      stats_locked: false,
      aggregate_applied_at: null,
      exclude_all_time: false,
      created_at: '',
      updated_at: '',
    });
    vi.mocked(getBattleStatsByGame).mockResolvedValue([
      {
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
      },
    ]);
    vi.mocked(markGameAggregatesApplied).mockResolvedValue({
      id: 'game-1',
      match_id: 'match-1',
      game_number: 1,
      winner_id: 'player-1',
      replay_url: '',
      source: 'manual',
      parsed: true,
      stats_locked: false,
      aggregate_applied_at: '2026-05-21T00:00:00Z',
      exclude_all_time: false,
      created_at: '',
      updated_at: '',
    });
  });

  it('reclaims stale jobs before claiming new ones', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: 2, error: null })
      .mockResolvedValueOnce({ data: [], error: null });

    const result = await processAggregateJobs(20);

    expect(result.processed).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.reclaimed).toBe(2);
    expect(mockRpc).toHaveBeenCalledWith('reclaim_stale_aggregate_jobs');
  });

  it('returns early when no jobs are claimed', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: 0, error: null })
      .mockResolvedValueOnce({ data: null, error: null });

    const result = await processAggregateJobs(20);

    expect(result.processed).toBe(0);
    expect(result.reclaimed).toBe(0);
  });

  it('calls claim_aggregate_jobs RPC with the limit', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: 0, error: null })
      .mockResolvedValueOnce({ data: [], error: null });

    await processAggregateJobs(10);

    expect(mockRpc).toHaveBeenCalledWith('claim_aggregate_jobs', { p_limit: 10 });
  });

  it('logs claim errors but returns gracefully without throwing', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: 0, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'RPC error' } });

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await processAggregateJobs(20);

    expect(result.processed).toBe(0);
    expect(consoleErrorSpy).toHaveBeenCalledWith('[aggregate-queue] Claim error:', expect.any(Object));
    consoleErrorSpy.mockRestore();
  });

  it('applies aggregates and marks the game applied for claimed jobs', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: 0, error: null })
      .mockResolvedValueOnce({
        data: [{
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
        }],
        error: null,
      });

    const result = await processAggregateJobs(20);

    expect(result.processed).toBe(1);
    expect(updateAggregates).toHaveBeenCalledTimes(1);
    expect(markGameAggregatesApplied).toHaveBeenCalledWith('game-1');
    expect(revalidateMatchPages).toHaveBeenCalledWith('tourney-1');
  });

  it('skips aggregate updates for already-applied games', async () => {
    vi.mocked(getGameById).mockResolvedValueOnce({
      id: 'game-1',
      match_id: 'match-1',
      game_number: 1,
      winner_id: 'player-1',
      replay_url: '',
      source: 'manual',
      parsed: true,
      stats_locked: false,
      aggregate_applied_at: '2026-05-21T00:00:00Z',
      exclude_all_time: false,
      created_at: '',
      updated_at: '',
    });
    mockRpc
      .mockResolvedValueOnce({ data: 0, error: null })
      .mockResolvedValueOnce({
        data: [{
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
        }],
        error: null,
      });

    const result = await processAggregateJobs(20);

    expect(result.processed).toBe(1);
    expect(updateAggregates).not.toHaveBeenCalled();
    expect(markGameAggregatesApplied).not.toHaveBeenCalled();
    expect(revalidateMatchPages).not.toHaveBeenCalled();
  });
});

// ─── cancelAggregateJobsForGame ───────────────────────────────────

describe('cancelAggregateJobsForGame', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls the cancel RPC with the game_id', async () => {
    mockRpc.mockResolvedValueOnce({ data: 3, error: null });

    const result = await cancelAggregateJobsForGame('game-1');

    expect(mockRpc).toHaveBeenCalledWith('cancel_aggregate_jobs_for_game', {
      p_game_id: 'game-1',
    });
    expect(result).toBe(3);
  });

  it('returns 0 on RPC error', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'Cancel failed' } });

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await cancelAggregateJobsForGame('game-1');

    expect(result).toBe(0);
    expect(consoleErrorSpy).toHaveBeenCalledWith('[aggregate-queue] Cancel error:', expect.any(Object));
    consoleErrorSpy.mockRestore();
  });

  it('returns 0 when RPC returns null', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });

    const result = await cancelAggregateJobsForGame('game-1');

    expect(result).toBe(0);
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