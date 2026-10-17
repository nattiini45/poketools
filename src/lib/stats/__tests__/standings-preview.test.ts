import { describe, expect, it } from 'vitest';
import { playerStandingFromRows, type StandingsPreviewRow } from '../standings-preview';

const rows: StandingsPreviewRow[] = [
  { rank: 1, player_id: 'a', player_name: 'Ash', wins: 9, losses: 1 },
  { rank: 2, player_id: 'b', player_name: 'Misty', wins: 4, losses: 6 },
  { rank: 3, player_id: 'c', player_name: 'Brock', wins: 2, losses: 8 },
];

describe('playerStandingFromRows', () => {
  it("returns the player's rank, the table size and the record", () => {
    expect(playerStandingFromRows(rows, 'b')).toEqual({ rank: 2, total: 3, wins: 4, losses: 6 });
  });

  it('matches by player id, not by name', () => {
    expect(playerStandingFromRows(rows, 'Misty')).toBeNull();
  });

  it('returns null for a player outside the table', () => {
    expect(playerStandingFromRows(rows, 'z')).toBeNull();
    expect(playerStandingFromRows([], 'a')).toBeNull();
  });
});
