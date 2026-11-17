import { beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ from: vi.fn(), settle: vi.fn() }));
vi.mock('../../client', () => ({ supabase: { from: h.from } }));
import { getPhaseStandingsBattleStats } from '../phase-games';
import { getNativeKitCompletedRecords } from '../phase-format-runtime';

const query = {
  select: vi.fn(), eq: vi.fn(), order: vi.fn(), range: vi.fn(),
  then: (resolve: (value: unknown) => unknown) => Promise.resolve(h.settle()).then(resolve),
};
beforeEach(() => {
  vi.resetAllMocks();
  for (const key of ['select', 'eq', 'order', 'range'] as const) query[key].mockReturnValue(query);
  h.from.mockReturnValue(query);
});

it('pages native completed phase stats, preserves round granularity and returns the narrow standings shape', async () => {
  h.settle.mockReturnValueOnce({ data: [{ id: 'private-id', game_id: 'game', player_id: 'player', pokemon_name: 'Pikachu',
    was_brought: true, was_lead: false, kos_dealt: 2, was_koed: false,
    moves_used: ['private-extra'], phase_games: { phase_matches: { phase_rounds: { round_number: 3 } } },
  }], error: null }).mockReturnValueOnce({ data: [], error: null });
  expect(await getPhaseStandingsBattleStats('phase')).toEqual([{ game_id: 'game', player_id: 'player', pokemon_name: 'Pikachu',
    was_brought: true, was_lead: false, kos_dealt: 2, was_koed: false, round_number: 3 }]);
  expect(h.from).toHaveBeenCalledWith('phase_battle_stats');
  expect(query.eq).toHaveBeenCalledWith('phase_games.phase_matches.phase_id', 'phase');
  expect(query.eq).toHaveBeenCalledWith('phase_games.phase_matches.status', 'completed');
  expect(query.order).toHaveBeenCalledWith('id');
  expect(query.range.mock.calls).toEqual([[0, 999], [1, 1000]]);
  expect(query.select.mock.calls[0][0]).not.toContain('moves_used');
});

it('propagates native stats failures', async () => {
  const error = new Error('Stats read failed'); h.settle.mockReturnValue({ data: null, error });
  await expect(getPhaseStandingsBattleStats('phase')).rejects.toBe(error);
});

it('retains real native playoff positions when assembling completed standings records', async () => {
  h.settle.mockReturnValueOnce({ data: [{ id: 'final', player_1_id: 'one', player_2_id: 'two', winner_id: 'two',
    bracket_side: 'grand_finals', bracket_pos: 0, phase_rounds: { round_number: 4 } }], error: null })
    .mockReturnValueOnce({ data: [], error: null });
  expect(await getNativeKitCompletedRecords('phase')).toEqual([{ match_id: 'final', player_1_id: 'one', player_2_id: 'two',
    winner_id: 'two', round_number: 4, bracket_side: 'grand_finals', bracket_pos: 0 }]);
  expect(h.from).toHaveBeenCalledWith('phase_matches');
  expect(query.eq).toHaveBeenCalledWith('phase_id', 'phase');
  expect(query.eq).toHaveBeenCalledWith('status', 'completed');
});

it('does not silently treat an unknown stored bracket side as a valid playoff position', async () => {
  h.settle.mockReturnValueOnce({ data: [{ id: 'final', bracket_side: 'unknown', phase_rounds: { round_number: 4 } }], error: null })
    .mockReturnValueOnce({ data: [], error: null });
  await expect(getNativeKitCompletedRecords('phase')).rejects.toThrow('unknown bracket side');
});
