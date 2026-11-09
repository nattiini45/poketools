import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/queries/matches', () => ({ getMatchById: vi.fn() }));
vi.mock('@/lib/supabase/queries/rounds', () => ({ getRoundById: vi.fn() }));

import { getMatchById } from '@/lib/supabase/queries/matches';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { isMatchParticipant, roundNumberOfMatch, roundOfMatch } from '../match-round';

const match = (over: Record<string, unknown> = {}) =>
  ({ id: 'm-1', tournament_id: 't-1', round_id: 'r-3', player_1_id: 'p1', player_2_id: 'p2', ...over }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getMatchById).mockResolvedValue(match());
  vi.mocked(getRoundById).mockResolvedValue({ id: 'r-3', round_number: 3 } as never);
});

describe('roundNumberOfMatch', () => {
  it('is the round number of the round the match is in', async () => {
    expect(await roundNumberOfMatch({ round_id: 'r-3' })).toBe(3);
    expect(getRoundById).toHaveBeenCalledWith('r-3');
  });

  it('is undefined when the round row is gone', async () => {
    vi.mocked(getRoundById).mockResolvedValue(null);
    expect(await roundNumberOfMatch({ round_id: 'r-3' })).toBeUndefined();
  });
});

describe('roundOfMatch', () => {
  it('answers the match and its round for a match of the tournament', async () => {
    expect(await roundOfMatch('m-1', 't-1')).toEqual({ status: 'ok', match: match(), roundNumber: 3 });
  });

  it('answers not_found for a missing match and for a match of another tournament, without reading its round', async () => {
    vi.mocked(getMatchById).mockResolvedValue(null);
    expect(await roundOfMatch('m-1', 't-1')).toEqual({ status: 'not_found' });

    vi.mocked(getMatchById).mockResolvedValue(match({ tournament_id: 't-other' }));
    expect(await roundOfMatch('m-1', 't-1')).toEqual({ status: 'not_found' });
    expect(getRoundById).not.toHaveBeenCalled();
  });

  it('keeps a missing round as an undefined round number', async () => {
    vi.mocked(getRoundById).mockResolvedValue(null);
    expect(await roundOfMatch('m-1', 't-1')).toMatchObject({ status: 'ok', roundNumber: undefined });
  });

  it('lets a failed read through, for the caller to report', async () => {
    vi.mocked(getMatchById).mockRejectedValue(new Error('db'));
    await expect(roundOfMatch('m-1', 't-1')).rejects.toThrow('db');
  });
});

describe('isMatchParticipant', () => {
  it('is true for either side of the match and false for anyone else', () => {
    const m = { player_1_id: 'p1', player_2_id: 'p2' };
    expect(isMatchParticipant(m, 'p1')).toBe(true);
    expect(isMatchParticipant(m, 'p2')).toBe(true);
    expect(isMatchParticipant(m, 'p3')).toBe(false);
  });
});
