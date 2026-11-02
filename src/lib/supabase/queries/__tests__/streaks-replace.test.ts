import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const rpc = vi.fn();
  const pages: Array<{ data: unknown; error?: unknown }> = [];
  const ranges: Array<[number, number]> = [];
  const filters: Array<[string, unknown]> = [];
  const select = vi.fn();
  const query = {
    select: (...args: unknown[]) => {
      select(...args);
      return query;
    },
    eq: (column: string, value: unknown) => {
      filters.push([column, value]);
      return query;
    },
    order: () => query,
    range: (from: number, to: number) => {
      ranges.push([from, to]);
      const page = pages.shift() ?? { data: [] };
      return Promise.resolve({ data: page.data, error: page.error ?? null });
    },
  };
  return { rpc, pages, ranges, filters, select, from: vi.fn(() => query) };
});

vi.mock('@/lib/supabase/client', () => ({ supabase: { rpc: h.rpc, from: h.from } }));

import { getPlayerStatTotalsByMatch, replacePlayerStreaks, StreaksStaleError } from '../streaks';

const PLAYER = '11111111-1111-4111-8111-111111111111';
const M1 = '22222222-2222-4222-8222-222222222222';
const M2 = '33333333-3333-4333-8333-333333333333';

const ROW = {
  current_win_streak: 2,
  best_win_streak: 5,
  current_loss_streak: 0,
  best_loss_streak: 1,
  current_ko_streak: 1,
  best_ko_streak: 3,
  current_flawless_streak: 0,
  best_flawless_streak: 2,
  last_match_id: M2,
};

beforeEach(() => {
  h.rpc.mockReset();
  h.pages.length = 0;
  h.ranges.length = 0;
  h.filters.length = 0;
  h.select.mockClear();
});

describe('replacePlayerStreaks', () => {
  it('calls streaks_replace_player once with the row and the expected match ids', async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });

    await replacePlayerStreaks(PLAYER, ROW, [M1, M2]);

    expect(h.rpc).toHaveBeenCalledOnce();
    expect(h.rpc).toHaveBeenCalledWith('streaks_replace_player', {
      p_player_id: PLAYER,
      p_state: ROW,
      p_expected_match_ids: [M1, M2],
    });
  });

  it('maps the fence refusal (PT409) to StreaksStaleError', async () => {
    const error = { code: 'PT409', message: 'the completed matches changed' };
    h.rpc.mockResolvedValue({ data: null, error });

    const failure = await replacePlayerStreaks(PLAYER, ROW, [M1]).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(StreaksStaleError);
    expect((failure as StreaksStaleError).playerId).toBe(PLAYER);
    expect((failure as StreaksStaleError).cause).toBe(error);
  });

  it('propagates any other database error unchanged', async () => {
    const error = { code: '22023', message: 'state.best_win_streak must be a number' };
    h.rpc.mockResolvedValue({ data: null, error });

    await expect(replacePlayerStreaks(PLAYER, ROW, [])).rejects.toBe(error);
  });

  it('refuses a malformed player id before any request', async () => {
    await expect(replacePlayerStreaks('player-1', ROW, [])).rejects.toThrow();
    expect(h.rpc).not.toHaveBeenCalled();
  });
});

describe('getPlayerStatTotalsByMatch', () => {
  const stat = (matchId: string, kos: number, koed: boolean, id = `${matchId}-${kos}-${koed}`) => ({
    id,
    kos_dealt: kos,
    was_koed: koed,
    games: { match_id: matchId, matches: { status: 'completed' } },
  });

  it('sums the player rows per match; a match without rows is absent (unknown)', async () => {
    h.pages.push({ data: [stat(M1, 2, false, 'a'), stat(M1, 1, true, 'b'), stat(M2, 0, true, 'c')] });

    const totals = await getPlayerStatTotalsByMatch(PLAYER);

    expect(totals.get(M1)).toEqual({ total_kos_dealt: 3, total_kos_lost: 1 });
    expect(totals.get(M2)).toEqual({ total_kos_dealt: 0, total_kos_lost: 1 });
    expect(totals.has('44444444-4444-4444-8444-444444444444')).toBe(false);
    expect(h.filters).toContainEqual(['player_id', PLAYER]);
    expect(h.filters).toContainEqual(['games.matches.status', 'completed']);
  });

  it('pages past the 1000-row cap in ONE logical read (not one read per match)', async () => {
    const first = Array.from({ length: 1000 }, (_, i) => stat(M1, 1, false, `a-${i}`));
    const second = [stat(M2, 4, false, 'b-0')];
    h.pages.push({ data: first }, { data: second });

    const totals = await getPlayerStatTotalsByMatch(PLAYER);

    expect(totals.get(M1)).toEqual({ total_kos_dealt: 1000, total_kos_lost: 0 });
    expect(totals.get(M2)).toEqual({ total_kos_dealt: 4, total_kos_lost: 0 });
    expect(h.ranges[0]).toEqual([0, 999]);
    expect(h.ranges[1]).toEqual([1000, 1999]);
    expect(h.from).toHaveBeenCalledWith('battle_stats');
  });

  it('propagates a read error instead of returning partial totals', async () => {
    const error = new Error('read failed');
    h.pages.push({ data: null, error });

    await expect(getPlayerStatTotalsByMatch(PLAYER)).rejects.toBe(error);
  });
});
