import { describe, expect, it } from 'vitest';
import { isLegacyElimBracketData } from '@/components/bracket/legacy';
import type { Round } from '@/types/round';
import type { MatchWithPlayers } from '@/types/match';

function round(overrides: Partial<Round> = {}): Round {
  return {
    id: 'r-1',
    tournament_id: 't-1',
    name: 'Round 1',
    round_number: 1,
    best_of: 3,
    status: 'active',
    pairings_generated: true,
    deadline: null,
    bracket_side: null,
    bye_player_ids: [],
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

function match(overrides: Partial<MatchWithPlayers> = {}): MatchWithPlayers {
  return {
    id: 'm-1',
    round_id: 'r-1',
    tournament_id: 't-1',
    player_1_id: 'p1',
    player_2_id: 'p2',
    player_1_name: 'A',
    player_2_name: 'B',
    winner_id: null,
    status: 'scheduled',
    bracket_side: null,
    bracket_pos: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  } as MatchWithPlayers;
}

describe('isLegacyElimBracketData', () => {
  it('returns false when there are no rounds (new-engine path)', () => {
    expect(isLegacyElimBracketData([], [match()])).toBe(false);
  });

  it('returns true when rounds exist without bracket_side', () => {
    expect(isLegacyElimBracketData([round()])).toBe(true);
  });

  it('returns true when matches exist without bracket_pos', () => {
    expect(isLegacyElimBracketData([round()], [match()])).toBe(true);
  });

  it('returns false when any round has bracket_side (structure-generated)', () => {
    expect(
      isLegacyElimBracketData([round({ bracket_side: 'winners' })]),
    ).toBe(false);
  });

  it('returns false when rounds carry bracket_side even if matches lack bracket_pos', () => {
    expect(
      isLegacyElimBracketData(
        [round({ bracket_side: 'losers' })],
        [match({ bracket_pos: null })],
      ),
    ).toBe(false);
  });
});
