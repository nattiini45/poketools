import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PlayerStreaks } from '@/types/streak';

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/queries/ratings', () => ({
  getCompletedMatchesForRatingReplay: vi.fn(),
  loadRatingScope: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/streaks', () => ({
  StreaksStaleError: class StreaksStaleError extends Error {},
  getPlayerStreaks: vi.fn(),
  upsertPlayerStreaks: vi.fn(),
  replacePlayerStreaks: vi.fn(),
  getPlayerStatTotalsByMatch: vi.fn(),
}));

import { getCompletedMatchesForRatingReplay, loadRatingScope } from '@/lib/supabase/queries/ratings';
import {
  getPlayerStatTotalsByMatch,
  getPlayerStreaks,
  replacePlayerStreaks,
  StreaksStaleError,
  upsertPlayerStreaks,
} from '@/lib/supabase/queries/streaks';
import { createRatingScope } from '@/lib/rating/rating-scope';
import {
  computeStreaksFromHistory,
  recomputeStreaks,
  updateStreaks,
  type StreakHistoryMatch,
} from '../streaks';

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


it('keeps the KO and flawless streaks when the match has no battle stats (unknown), while win and loss still move', async () => {
  vi.mocked(getPlayerStreaks).mockResolvedValue(makeStreaks({
    current_win_streak: 2,
    best_win_streak: 2,
    current_ko_streak: 4,
    best_ko_streak: 4,
    current_flawless_streak: 3,
    best_flawless_streak: 5,
  }));

  const result = await updateStreaks(PLAYER_ID, { won: true, lost: false, drew: false }, null, 'match-12');

  expect(result.win_streak).toEqual({ before: 2, after: 3 });
  expect(result.ko_streak).toEqual({ before: 4, after: 4 });
  expect(result.flawless_streak).toEqual({ before: 3, after: 3 });
  expect(upsertPlayerStreaks).toHaveBeenCalledWith(PLAYER_ID, expect.objectContaining({
    current_ko_streak: 4,
    current_flawless_streak: 3,
    last_match_id: 'match-12',
  }));
});

// ── computeStreaksFromHistory ──────────────────────────────────────

const NO_TEST_LEAGUES = createRatingScope([]);

function histMatch(id: string, winner: string | null, day: number, over: Partial<StreakHistoryMatch> = {}): StreakHistoryMatch {
  const stamp = new Date(Date.UTC(2026, 0, day)).toISOString();
  return { id, tournament_id: 't1', winner_id: winner, date_played: stamp, created_at: stamp, ...over };
}

const stats = (dealt: number, lost: number) => ({ total_kos_dealt: dealt, total_kos_lost: lost });

describe('computeStreaksFromHistory', () => {
  it('replays in the canonical replay order, not the order the matches arrive in', () => {
    // Arrival order: loss, win, win, win. Played order: win, win, win, loss.
    const matches = [
      histMatch('d', 'opp', 4),
      histMatch('c', PLAYER_ID, 3),
      histMatch('a', PLAYER_ID, 1),
      histMatch('b', PLAYER_ID, 2),
    ];
    const result = computeStreaksFromHistory(PLAYER_ID, matches, new Map(), NO_TEST_LEAGUES);
    expect(result.best_win_streak).toBe(3);
    expect(result.current_win_streak).toBe(0);
    expect(result.current_loss_streak).toBe(1);
    expect(result.last_match_id).toBe('d');
  });

  it('orders an undated match by its created_at against dated ones (date_played ?? created_at)', () => {
    const matches = [
      histMatch('late-dated', 'opp', 3),
      histMatch('undated', PLAYER_ID, 2, { date_played: null }),
      histMatch('early-dated', PLAYER_ID, 1),
    ];
    const result = computeStreaksFromHistory(PLAYER_ID, matches, new Map(), NO_TEST_LEAGUES);
    expect(result.best_win_streak).toBe(2);
    expect(result.last_match_id).toBe('late-dated');
  });

  it('does not mutate its input', () => {
    const matches = [histMatch('b', PLAYER_ID, 2), histMatch('a', PLAYER_ID, 1)];
    computeStreaksFromHistory(PLAYER_ID, matches, new Map(), NO_TEST_LEAGUES);
    expect(matches.map((m) => m.id)).toEqual(['b', 'a']);
  });

  it('a draw resets both the win and the loss streak', () => {
    const afterWins = computeStreaksFromHistory(
      PLAYER_ID,
      [histMatch('a', PLAYER_ID, 1), histMatch('b', PLAYER_ID, 2), histMatch('c', null, 3)],
      new Map(),
      NO_TEST_LEAGUES,
    );
    expect(afterWins.current_win_streak).toBe(0);
    expect(afterWins.best_win_streak).toBe(2);

    const afterLosses = computeStreaksFromHistory(
      PLAYER_ID,
      [histMatch('a', 'opp', 1), histMatch('b', 'opp', 2), histMatch('c', null, 3), histMatch('d', 'opp', 4)],
      new Map(),
      NO_TEST_LEAGUES,
    );
    expect(afterLosses.best_loss_streak).toBe(2);
    expect(afterLosses.current_loss_streak).toBe(1);
  });

  it('leaves KO and flawless streaks unchanged for a match without stats, while win and loss move', () => {
    const matches = [
      histMatch('a', PLAYER_ID, 1),
      histMatch('b', PLAYER_ID, 2), // settled by an admin: no battle stats
      histMatch('c', PLAYER_ID, 3),
    ];
    const statsByMatch = new Map([
      ['a', stats(4, 0)],
      ['c', stats(5, 0)],
    ]);
    const result = computeStreaksFromHistory(PLAYER_ID, matches, statsByMatch, NO_TEST_LEAGUES);
    expect(result.current_win_streak).toBe(3);
    // The unplayed match neither extended nor broke the streaks: a, (b), c count as two.
    expect(result.current_ko_streak).toBe(2);
    expect(result.current_flawless_streak).toBe(2);
  });

  it('does not reset a running KO or flawless streak on a stats-less loss', () => {
    const matches = [histMatch('a', PLAYER_ID, 1), histMatch('b', 'opp', 2)];
    const result = computeStreaksFromHistory(PLAYER_ID, matches, new Map([['a', stats(3, 0)]]), NO_TEST_LEAGUES);
    expect(result.current_win_streak).toBe(0);
    expect(result.current_loss_streak).toBe(1);
    expect(result.current_ko_streak).toBe(1);
    expect(result.current_flawless_streak).toBe(1);
  });

  it('decides stats per player: only the player with a stats block gets KO and flawless updates', () => {
    const matches = [histMatch('a', PLAYER_ID, 1)];
    const mine = computeStreaksFromHistory(PLAYER_ID, matches, new Map([['a', stats(3, 1)]]), NO_TEST_LEAGUES);
    expect(mine.current_ko_streak).toBe(1);
    expect(mine.current_flawless_streak).toBe(0);

    const opponentsView = [histMatch('a', PLAYER_ID, 1)];
    const theirs = computeStreaksFromHistory('opp', opponentsView, new Map(), NO_TEST_LEAGUES);
    expect(theirs.current_loss_streak).toBe(1);
    expect(theirs.current_ko_streak).toBe(0);
    expect(theirs.current_flawless_streak).toBe(0);
  });

  it('skips matches of a test league, like the ratings', () => {
    const scope = createRatingScope(['t-test']);
    const matches = [
      histMatch('a', PLAYER_ID, 1),
      histMatch('b', PLAYER_ID, 2, { tournament_id: 't-test' }),
      histMatch('c', 'opp', 3, { tournament_id: 't-test' }),
      histMatch('d', PLAYER_ID, 4),
    ];
    const result = computeStreaksFromHistory(PLAYER_ID, matches, new Map(), scope);
    expect(result.current_win_streak).toBe(2);
    expect(result.best_loss_streak).toBe(0);
    expect(result.last_match_id).toBe('d');
  });

  it('returns an all-zero row for a player with no counted match', () => {
    const result = computeStreaksFromHistory(PLAYER_ID, [], new Map(), NO_TEST_LEAGUES);
    expect(result).toEqual({
      current_win_streak: 0,
      best_win_streak: 0,
      current_loss_streak: 0,
      best_loss_streak: 0,
      current_ko_streak: 0,
      best_ko_streak: 0,
      current_flawless_streak: 0,
      best_flawless_streak: 0,
      last_match_id: null,
    });
  });
});

// ── recomputeStreaks ───────────────────────────────────────────────

describe('recomputeStreaks', () => {
  beforeEach(() => {
    vi.mocked(loadRatingScope).mockResolvedValue(NO_TEST_LEAGUES);
    vi.mocked(getPlayerStatTotalsByMatch).mockResolvedValue(new Map());
    vi.mocked(getPlayerStreaks).mockResolvedValue(null);
    vi.mocked(replacePlayerStreaks).mockReset();
    vi.mocked(replacePlayerStreaks).mockResolvedValue(undefined);
  });

  it('writes the replayed row once through the fenced replace, with no zeroing write', async () => {
    vi.mocked(getCompletedMatchesForRatingReplay).mockResolvedValue([
      histMatch('match-b', PLAYER_ID, 2),
      histMatch('match-a', PLAYER_ID, 1),
    ] as never);
    vi.mocked(getPlayerStatTotalsByMatch).mockResolvedValue(new Map([['match-a', stats(2, 0)], ['match-b', stats(2, 0)]]));

    const changes = await recomputeStreaks(PLAYER_ID);

    expect(upsertPlayerStreaks).not.toHaveBeenCalled();
    expect(replacePlayerStreaks).toHaveBeenCalledOnce();
    const [playerId, row, expectedIds] = vi.mocked(replacePlayerStreaks).mock.calls[0];
    expect(playerId).toBe(PLAYER_ID);
    expect(row).toMatchObject({ current_win_streak: 2, best_win_streak: 2, last_match_id: 'match-b' });
    expect([...expectedIds].sort()).toEqual(['match-a', 'match-b']);
    expect(changes.win_streak).toEqual({ before: 0, after: 2 });
    expect(changes.new_records).toContain('win_streak');
  });

  it('fences on every completed match, including the ones a test league keeps out of the numbers', async () => {
    vi.mocked(loadRatingScope).mockResolvedValue(createRatingScope(['t-test']));
    vi.mocked(getCompletedMatchesForRatingReplay).mockResolvedValue([
      histMatch('real', PLAYER_ID, 1),
      histMatch('test', PLAYER_ID, 2, { tournament_id: 't-test' }),
    ] as never);

    await recomputeStreaks(PLAYER_ID);

    const [, row, expectedIds] = vi.mocked(replacePlayerStreaks).mock.calls[0];
    expect(row.current_win_streak).toBe(1);
    expect([...expectedIds].sort()).toEqual(['real', 'test']);
  });

  it('writes a zero row for a player with no completed match', async () => {
    vi.mocked(getCompletedMatchesForRatingReplay).mockResolvedValue([]);

    await recomputeStreaks(PLAYER_ID);

    expect(replacePlayerStreaks).toHaveBeenCalledWith(
      PLAYER_ID,
      expect.objectContaining({ current_win_streak: 0, best_win_streak: 0, last_match_id: null }),
      [],
    );
  });

  it('keeps the best win streak of the oldest run in a history longer than 1000 matches', async () => {
    // 600 wins, a loss, then 500 matches alternating loss/win: the best run is the oldest one.
    const history: StreakHistoryMatch[] = [];
    let day = 0;
    const base = Date.UTC(2020, 0, 1);
    const add = (winner: string | null) => {
      const stamp = new Date(base + 60_000 * day).toISOString();
      history.push({ id: `m-${String(day).padStart(5, '0')}`, tournament_id: 't1', winner_id: winner, date_played: stamp, created_at: stamp });
      day += 1;
    };
    for (let i = 0; i < 600; i++) add(PLAYER_ID);
    add('opp');
    for (let i = 0; i < 500; i++) add(i % 2 === 0 ? 'opp' : PLAYER_ID);
    expect(history.length).toBe(1101);
    // The reader hands matches over newest first; the replay must not depend on that.
    vi.mocked(getCompletedMatchesForRatingReplay).mockResolvedValue([...history].reverse() as never);

    await recomputeStreaks(PLAYER_ID);

    const [, row, expectedIds] = vi.mocked(replacePlayerStreaks).mock.calls[0];
    expect(row.best_win_streak).toBe(600);
    expect(row.best_loss_streak).toBe(2);
    expect(expectedIds).toHaveLength(1101);
  });

  it('reads the history again and writes once more when the fence refuses (a match completed meanwhile)', async () => {
    vi.mocked(getCompletedMatchesForRatingReplay)
      .mockResolvedValueOnce([histMatch('a', PLAYER_ID, 1)] as never)
      .mockResolvedValueOnce([histMatch('a', PLAYER_ID, 1), histMatch('b', PLAYER_ID, 2)] as never);
    vi.mocked(replacePlayerStreaks)
      .mockRejectedValueOnce(new StreaksStaleError(PLAYER_ID, new Error('PT409')))
      .mockResolvedValueOnce(undefined);

    await recomputeStreaks(PLAYER_ID);

    expect(getCompletedMatchesForRatingReplay).toHaveBeenCalledTimes(2);
    expect(replacePlayerStreaks).toHaveBeenCalledTimes(2);
    const [, row, expectedIds] = vi.mocked(replacePlayerStreaks).mock.calls[1];
    expect(row.current_win_streak).toBe(2);
    expect(expectedIds).toEqual(['a', 'b']);
  });

  it('gives up after the retry and surfaces the stale error', async () => {
    vi.mocked(getCompletedMatchesForRatingReplay).mockResolvedValue([histMatch('a', PLAYER_ID, 1)] as never);
    vi.mocked(replacePlayerStreaks).mockRejectedValue(new StreaksStaleError(PLAYER_ID, new Error('PT409')));

    await expect(recomputeStreaks(PLAYER_ID)).rejects.toBeInstanceOf(StreaksStaleError);
    expect(replacePlayerStreaks).toHaveBeenCalledTimes(2);
  });

  it('does not retry an error that is not the fence', async () => {
    vi.mocked(getCompletedMatchesForRatingReplay).mockResolvedValue([histMatch('a', PLAYER_ID, 1)] as never);
    vi.mocked(replacePlayerStreaks).mockRejectedValue(new Error('connection refused'));

    await expect(recomputeStreaks(PLAYER_ID)).rejects.toThrow('connection refused');
    expect(replacePlayerStreaks).toHaveBeenCalledTimes(1);
  });

  it('is replay-safe: a second run lands on the same row whatever the stored row says', async () => {
    vi.mocked(getCompletedMatchesForRatingReplay).mockResolvedValue([
      histMatch('a', PLAYER_ID, 1),
      histMatch('b', 'opp', 2),
    ] as never);
    vi.mocked(getPlayerStreaks).mockResolvedValue(makeStreaks({ current_win_streak: 40, best_win_streak: 40 }));

    await recomputeStreaks(PLAYER_ID);
    await recomputeStreaks(PLAYER_ID);

    const [first, second] = vi.mocked(replacePlayerStreaks).mock.calls;
    expect(second[1]).toEqual(first[1]);
    expect(first[1]).toMatchObject({ best_win_streak: 1, current_loss_streak: 1 });
  });
});
