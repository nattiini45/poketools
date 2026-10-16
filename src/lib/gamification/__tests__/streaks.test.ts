import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PlayerStreaks } from '@/types/streak';

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/queries/games', () => ({
  getBattleStatsByMatch: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchesByPlayer: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/streaks', () => ({
  getPlayerStreaks: vi.fn(),
  upsertPlayerStreaks: vi.fn(),
}));

import { getBattleStatsByMatch } from '@/lib/supabase/queries/games';
import { getMatchesByPlayer } from '@/lib/supabase/queries/matches';
import { getPlayerStreaks, upsertPlayerStreaks } from '@/lib/supabase/queries/streaks';
import { updateStreaks, recomputeStreaks } from '../streaks';

// ── Helpers ────────────────────────────────────────────────────────

const PLAYER_ID = 'player-1';

function makeStreaks(overrides?: Partial<PlayerStreaks>): PlayerStreaks {
  return {
    id: 'streak-1',
    player_id: PLAYER_ID,
    current_win_streak: 0,
    best_win_streak: 0,
    current_loss_streak: 0,
    best_loss_streak: 0,
    current_ko_streak: 0,
    best_ko_streak: 0,
    current_flawless_streak: 0,
    best_flawless_streak: 0,
    last_match_id: null,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(upsertPlayerStreaks).mockResolvedValue(undefined as never);
});

describe('updateStreaks', () => {
  it('increments win streak on a win', async () => {
    vi.mocked(getPlayerStreaks).mockResolvedValue(makeStreaks({ current_win_streak: 3 }));

    const result = await updateStreaks(
      PLAYER_ID,
      { won: true, lost: false, drew: false },
      { total_kos_dealt: 2, total_kos_lost: 1 },
      'match-1'
    );

    expect(result.win_streak).toEqual({ before: 3, after: 4 });
    expect(result.loss_streak).toEqual({ before: 0, after: 0 });
  });

  it('resets win streak on a loss', async () => {
    vi.mocked(getPlayerStreaks).mockResolvedValue(makeStreaks({ current_win_streak: 5 }));

    const result = await updateStreaks(
      PLAYER_ID,
      { won: false, lost: true, drew: false },
      { total_kos_dealt: 1, total_kos_lost: 3 },
      'match-2'
    );

    expect(result.win_streak).toEqual({ before: 5, after: 0 });
    expect(result.loss_streak).toEqual({ before: 0, after: 1 });
  });

  it('resets win streak on a draw', async () => {
    vi.mocked(getPlayerStreaks).mockResolvedValue(makeStreaks({ current_win_streak: 3 }));

    const result = await updateStreaks(
      PLAYER_ID,
      { won: false, lost: false, drew: true },
      { total_kos_dealt: 2, total_kos_lost: 2 },
      'match-3'
    );

    expect(result.win_streak).toEqual({ before: 3, after: 0 });
    expect(result.loss_streak).toEqual({ before: 0, after: 0 });
  });

  it('increments ko_streak when 3+ KOs dealt', async () => {
    vi.mocked(getPlayerStreaks).mockResolvedValue(makeStreaks({ current_ko_streak: 2 }));

    const result = await updateStreaks(
      PLAYER_ID,
      { won: true, lost: false, drew: false },
      { total_kos_dealt: 4, total_kos_lost: 1 },
      'match-4'
    );

    expect(result.ko_streak).toEqual({ before: 2, after: 3 });
  });

  it('resets ko_streak when fewer than 3 KOs dealt', async () => {
    vi.mocked(getPlayerStreaks).mockResolvedValue(makeStreaks({ current_ko_streak: 5 }));

    const result = await updateStreaks(
      PLAYER_ID,
      { won: true, lost: false, drew: false },
      { total_kos_dealt: 2, total_kos_lost: 0 },
      'match-5'
    );

    expect(result.ko_streak).toEqual({ before: 5, after: 0 });
  });

  it('increments flawless_streak when no KOs lost', async () => {
    vi.mocked(getPlayerStreaks).mockResolvedValue(makeStreaks({ current_flawless_streak: 1 }));

    const result = await updateStreaks(
      PLAYER_ID,
      { won: true, lost: false, drew: false },
      { total_kos_dealt: 3, total_kos_lost: 0 },
      'match-6'
    );

    expect(result.flawless_streak).toEqual({ before: 1, after: 2 });
  });

  it('resets flawless_streak when any KOs lost', async () => {
    vi.mocked(getPlayerStreaks).mockResolvedValue(makeStreaks({ current_flawless_streak: 3 }));

    const result = await updateStreaks(
      PLAYER_ID,
      { won: true, lost: false, drew: false },
      { total_kos_dealt: 4, total_kos_lost: 1 },
      'match-7'
    );

    expect(result.flawless_streak).toEqual({ before: 3, after: 0 });
  });

  it('reports new records when best is surpassed', async () => {
    vi.mocked(getPlayerStreaks).mockResolvedValue(makeStreaks({
      current_win_streak: 4,
      best_win_streak: 4,
    }));

    const result = await updateStreaks(
      PLAYER_ID,
      { won: true, lost: false, drew: false },
      { total_kos_dealt: 2, total_kos_lost: 1 },
      'match-8'
    );

    expect(result.win_streak.after).toBe(5);
    expect(result.new_records).toContain('win_streak');
  });

  it('does not report new records when best is not surpassed', async () => {
    vi.mocked(getPlayerStreaks).mockResolvedValue(makeStreaks({
      current_win_streak: 2,
      best_win_streak: 10,
    }));

    const result = await updateStreaks(
      PLAYER_ID,
      { won: true, lost: false, drew: false },
      { total_kos_dealt: 2, total_kos_lost: 1 },
      'match-9'
    );

    expect(result.new_records).toEqual([]);
  });

  it('creates default streaks when player has no existing record', async () => {
    vi.mocked(getPlayerStreaks).mockResolvedValue(null);

    const result = await updateStreaks(
      PLAYER_ID,
      { won: true, lost: false, drew: false },
      { total_kos_dealt: 4, total_kos_lost: 0 },
      'match-10'
    );

    expect(result.win_streak).toEqual({ before: 0, after: 1 });
    expect(result.ko_streak).toEqual({ before: 0, after: 1 });
    expect(result.flawless_streak).toEqual({ before: 0, after: 1 });
    expect(result.new_records).toContain('win_streak');
  });

  it('persists updated streaks via upsertPlayerStreaks', async () => {
    vi.mocked(getPlayerStreaks).mockResolvedValue(makeStreaks());

    await updateStreaks(
      PLAYER_ID,
      { won: true, lost: false, drew: false },
      { total_kos_dealt: 1, total_kos_lost: 0 },
      'match-11'
    );

    expect(upsertPlayerStreaks).toHaveBeenCalledWith(PLAYER_ID, expect.objectContaining({
      current_win_streak: 1,
      last_match_id: 'match-11',
    }));
  });
});

describe('recomputeStreaks', () => {
  it('resets streaks then replays matches in chronological order', async () => {
    vi.mocked(getMatchesByPlayer).mockResolvedValue([
      { id: 'match-b', status: 'completed', winner_id: PLAYER_ID, date_played: '2025-01-02', created_at: '2025-01-02' },
      { id: 'match-a', status: 'completed', winner_id: PLAYER_ID, date_played: '2025-01-01', created_at: '2025-01-01' },
      { id: 'match-c', status: 'scheduled', winner_id: null, date_played: null, created_at: '2025-01-03' },
    ] as never);

    vi.mocked(getBattleStatsByMatch).mockResolvedValue({
      'game-1': [{ player_id: PLAYER_ID, kos_dealt: 2, was_koed: false }],
    } as never);

    // getPlayerStreaks is called by updateStreaks each iteration
    vi.mocked(getPlayerStreaks).mockResolvedValue(null);

    await recomputeStreaks(PLAYER_ID);

    // First call resets to zero
    expect(upsertPlayerStreaks).toHaveBeenNthCalledWith(1, PLAYER_ID, expect.objectContaining({
      current_win_streak: 0,
      best_win_streak: 0,
    }));

    // Should replay 2 completed matches (skip scheduled), oldest first
    // 1 reset + 2 from updateStreaks = 3 calls total
    expect(upsertPlayerStreaks).toHaveBeenCalledTimes(3);
  });

  it('handles player with no completed matches', async () => {
    vi.mocked(getMatchesByPlayer).mockResolvedValue([
      { id: 'match-1', status: 'scheduled', winner_id: null, date_played: null, created_at: '2025-01-01' },
    ] as never);

    await recomputeStreaks(PLAYER_ID);

    // Only the reset call
    expect(upsertPlayerStreaks).toHaveBeenCalledOnce();
    expect(upsertPlayerStreaks).toHaveBeenCalledWith(PLAYER_ID, expect.objectContaining({
      current_win_streak: 0,
    }));
  });
});
