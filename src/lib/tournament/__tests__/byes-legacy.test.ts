/**
 * Legacy rounds (written before `rounds.bye_player_ids` existed) go through
 * the real read path: mocked Supabase rows without the column ->
 * getRoundsByTournament (toRound) -> scoringByeRecords / loadScoringByes ->
 * standings. A completed season's table must not move.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockBuilder } = vi.hoisted(() => {
  const mb: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['from', 'select', 'eq']) mb[m] = vi.fn().mockReturnValue(mb);
  mb.order = vi.fn();
  return { mockBuilder: mb };
});

vi.mock('@/lib/supabase/client', () => ({ supabase: mockBuilder }));

import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { scoringByeRecords } from '../byes';
import { byesThroughRound, loadScoringByes } from '../scoring-byes';
import { computeStandings } from '../standings';
import type { MatchRecord } from '../types';

const legacyRow = (round_number: number, extra: Record<string, unknown> = {}) => ({
  id: `rd-${round_number}`,
  tournament_id: 't-1',
  name: `Round ${round_number}`,
  round_number,
  best_of: 3,
  status: 'completed',
  pairings_generated: true,
  deadline: null,
  bracket_side: null,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
  ...extra,
});

const names = { a: 'A', b: 'B', c: 'C', d: 'D', e: 'E' };
const ids = ['a', 'b', 'c', 'd', 'e'];
const matches: MatchRecord[] = [
  { player_1_id: 'a', player_2_id: 'b', winner_id: 'a', round_number: 1 },
  { player_1_id: 'c', player_2_id: 'd', winner_id: 'c', round_number: 1 },
  { player_1_id: 'a', player_2_id: 'c', winner_id: 'c', round_number: 2 },
  { player_1_id: 'b', player_2_id: 'e', winner_id: 'b', round_number: 2 },
];

beforeEach(() => {
  vi.clearAllMocks();
  for (const m of ['from', 'select', 'eq']) mockBuilder[m].mockReturnValue(mockBuilder);
});

describe('legacy Swiss rounds (no bye column in the row)', () => {
  it('give no bye records and leave the standings untouched', async () => {
    // Rows from before the migration: the key is absent (and one is null).
    mockBuilder.order.mockReturnValue({
      data: [legacyRow(1), legacyRow(2, { bye_player_ids: null })],
      error: null,
    });

    const rounds = await getRoundsByTournament('t-1');
    expect(rounds.map((r) => r.bye_player_ids)).toEqual([[], []]);

    const byes = scoringByeRecords('swiss', rounds);
    expect(byes).toEqual([]);
    expect(computeStandings(ids, names, matches, {}, { byes })).toEqual(
      computeStandings(ids, names, matches),
    );
  });

  it('loadScoringByes returns nothing for them', async () => {
    mockBuilder.order.mockReturnValue({ data: [legacyRow(1), legacyRow(2)], error: null });

    expect(await loadScoringByes({ id: 't-1', bracket_type: 'swiss' })).toEqual([]);
  });
});

describe('loadScoringByes', () => {
  it('reads the rounds of a Swiss tournament and scores their stored byes', async () => {
    mockBuilder.order.mockReturnValue({
      data: [legacyRow(1, { bye_player_ids: ['e'] }), legacyRow(2)],
      error: null,
    });

    const byes = await loadScoringByes({ id: 't-1', bracket_type: 'swiss' });

    expect(byes).toEqual([{ player_id: 'e', round_number: 1 }]);
    expect(mockBuilder.eq).toHaveBeenCalledWith('tournament_id', 't-1');
  });

  it('reads no round for a round robin or elimination tournament', async () => {
    for (const bracketType of ['round_robin', 'single_elim', 'double_elim', null] as const) {
      expect(await loadScoringByes({ id: 't-1', bracket_type: bracketType })).toEqual([]);
    }
    expect(mockBuilder.from).not.toHaveBeenCalled();
  });
});

describe('byesThroughRound', () => {
  it('keeps the byes of rounds up to and including the round', () => {
    const byes = [
      { player_id: 'a', round_number: 1 },
      { player_id: 'b', round_number: 2 },
      { player_id: 'c', round_number: 3 },
    ];
    expect(byesThroughRound(byes, 2).map((b) => b.player_id)).toEqual(['a', 'b']);
    expect(byesThroughRound(byes, 0)).toEqual([]);
  });
});
