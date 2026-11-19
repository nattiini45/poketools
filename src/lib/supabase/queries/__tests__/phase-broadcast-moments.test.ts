import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPhaseMomentsByMatch, getRecentPhaseMomentsByMatch } from '../phase-broadcast-moments';
import type { BroadcastMoment } from '@/types/broadcast';

const query = vi.hoisted(() => ({
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn(),
  range: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({ supabase: query }));

const moment: BroadcastMoment = {
  id: 'moment-1',
  game_id: null,
  match_id: 'match-1',
  turn_number: null,
  moment_type: 'highlight',
  description: 'A close finish',
  pokemon_name: null,
  timestamp: '2026-10-01T00:00:00Z',
  created_by: 'player-1',
};

describe('phase broadcast moment reads', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads only recent moments from the matching native match, newest first', async () => {
    query.limit.mockResolvedValueOnce({ data: [moment], error: null });

    await expect(getRecentPhaseMomentsByMatch(moment.match_id)).resolves.toEqual([moment]);
    expect(query.from).toHaveBeenCalledExactlyOnceWith('phase_broadcast_moments');
    expect(query.eq).toHaveBeenCalledExactlyOnceWith('match_id', moment.match_id);
    expect(query.order).toHaveBeenNthCalledWith(1, 'timestamp', { ascending: false });
    expect(query.order).toHaveBeenNthCalledWith(2, 'id');
    expect(query.limit).toHaveBeenCalledExactlyOnceWith(5);
    expect(query.range).not.toHaveBeenCalled();
  });

  it('pages match history oldest first without the recent limit', async () => {
    const nextMoment = { ...moment, id: 'moment-2' };
    query.range
      .mockResolvedValueOnce({ data: [moment], error: null })
      .mockResolvedValueOnce({ data: [nextMoment], error: null })
      .mockResolvedValueOnce({ data: [], error: null });

    await expect(getPhaseMomentsByMatch(moment.match_id)).resolves.toEqual([moment, nextMoment]);
    expect(query.from).toHaveBeenCalledWith('phase_broadcast_moments');
    expect(query.eq).toHaveBeenCalledWith('match_id', moment.match_id);
    expect(query.order).toHaveBeenNthCalledWith(1, 'timestamp', { ascending: true });
    expect(query.order).toHaveBeenNthCalledWith(2, 'id');
    expect(query.range.mock.calls).toEqual([[0, 999], [1, 1000], [2, 1001]]);
    expect(query.limit).not.toHaveBeenCalled();
  });

  it('propagates failures instead of reporting no moments', async () => {
    const error = new Error('moment read failed');
    query.limit.mockResolvedValueOnce({ data: null, error });

    await expect(getRecentPhaseMomentsByMatch(moment.match_id)).rejects.toBe(error);
  });
});
