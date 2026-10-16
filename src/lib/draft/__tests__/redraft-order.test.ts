import { describe, expect, it } from 'vitest';
import { DraftRuleError } from '../errors';
import { computeRedraftSeats, redraftParticipantOrder } from '../redraft-order';

describe('computeRedraftSeats', () => {
  const standings = [{ player_id: 'first' }, { player_id: 'second' }, { player_id: 'third' }, { player_id: 'last' }];

  it('seat 1 = last place, ascending toward the best; standing_rank 1 = best', () => {
    expect(computeRedraftSeats(standings)).toEqual([
      { player_id: 'last', seat: 1, standing_rank: 4 },
      { player_id: 'third', seat: 2, standing_rank: 3 },
      { player_id: 'second', seat: 3, standing_rank: 2 },
      { player_id: 'first', seat: 4, standing_rank: 1 },
    ]);
  });

  it('keeps the given standings order for ties (frozen, never re-sorted)', () => {
    const tied = [{ player_id: 'b' }, { player_id: 'a' }];
    expect(redraftParticipantOrder(tied)).toEqual(['a', 'b']);
    expect(redraftParticipantOrder([...tied].reverse())).toEqual(['b', 'a']);
  });

  it('returns player ids worst first for participant_order', () => {
    expect(redraftParticipantOrder(standings)).toEqual(['last', 'third', 'second', 'first']);
  });

  it('handles empty and single-player standings', () => {
    expect(computeRedraftSeats([])).toEqual([]);
    expect(computeRedraftSeats([{ player_id: 'solo' }])).toEqual([{ player_id: 'solo', seat: 1, standing_rank: 1 }]);
  });

  it('rejects duplicate or empty player ids with SEATS_INVALID', () => {
    expect(() => computeRedraftSeats([{ player_id: 'a' }, { player_id: 'a' }])).toThrow(DraftRuleError);
    try {
      computeRedraftSeats([{ player_id: '' }]);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(DraftRuleError);
      expect((err as DraftRuleError).code).toBe('SEATS_INVALID');
    }
  });
});
