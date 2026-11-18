import { beforeEach, expect, it, vi } from 'vitest';
import { getPhaseMatchesByRound } from '@/lib/supabase/queries/phase-matches';
import { completePhaseRound, updatePhaseRoundBestOf } from '@/lib/supabase/queries/phase-rounds';

const h = vi.hoisted(() => {
  const query = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), update: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(), maybeSingle: vi.fn(), range: vi.fn(),
  };
  return { query, from: vi.fn().mockReturnValue(query), rpc: vi.fn() };
});
vi.mock('@/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

beforeEach(() => vi.clearAllMocks());

it('does not overwrite best-of if the native round stops being pending after the route reads it', async () => {
  h.query.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
  await expect(updatePhaseRoundBestOf('round', 5)).rejects.toMatchObject({
    statusCode: 409, code: 'round_status_changed', params: { from: 'pending' },
  });
  expect(h.from).toHaveBeenCalledExactlyOnceWith('phase_rounds');
  expect(h.query.update).toHaveBeenCalledExactlyOnceWith({ best_of: 5 });
  expect(h.query.eq.mock.calls).toEqual([['id', 'round'], ['status', 'pending']]);
});

it('forwards the force flag to the locked native completion claim, not a raw status update', async () => {
  h.rpc.mockResolvedValueOnce({ data: { outcome: 'unfinished', unfinished: 4 }, error: null });
  await expect(completePhaseRound('round', { force: false })).resolves.toEqual({ outcome: 'unfinished', unfinished: 4 });
  expect(h.rpc).toHaveBeenCalledExactlyOnceWith('phase_round_complete', { p_round_id: 'round', p_force: false });
  expect(h.from).not.toHaveBeenCalled();
});

it('reads beyond the first PostgREST page for a round detail', async () => {
  const joined = { player_1: { name: 'Test One' }, player_2: { name: 'Test Two' }, round: { status: 'pending' } };
  h.query.range.mockResolvedValueOnce({
    data: Array.from({ length: 1000 }, (_, i) => ({ ...joined, id: `match-${i}` })), error: null,
  }).mockResolvedValueOnce({ data: [{ ...joined, id: 'last-match' }], error: null });
  const matches = await getPhaseMatchesByRound('round');
  expect(matches).toHaveLength(1001);
  expect(matches.at(-1)?.id).toBe('last-match');
  expect(h.from.mock.calls).toEqual([['phase_matches'], ['phase_matches']]);
  expect(h.query.eq.mock.calls).toEqual([['round_id', 'round'], ['round_id', 'round']]);
  expect(h.query.order.mock.calls).toEqual([['id'], ['id']]);
  expect(h.query.range.mock.calls).toEqual([[0, 999], [1000, 1999]]);
});
