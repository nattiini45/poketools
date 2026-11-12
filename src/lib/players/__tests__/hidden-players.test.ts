import { describe, expect, it } from 'vitest';
import { withoutHiddenPlayers } from '../hidden-players';

describe('withoutHiddenPlayers', () => {
  const rows = [{ player_id: 'a' }, { player_id: 'b' }, { player_id: 'c' }];

  it('drops the rows of hidden players and keeps the order', () => {
    expect(withoutHiddenPlayers(rows, ['b'])).toEqual([{ player_id: 'a' }, { player_id: 'c' }]);
  });

  it('returns the rows as they are when nobody is hidden', () => {
    expect(withoutHiddenPlayers(rows, [])).toBe(rows);
  });
});
