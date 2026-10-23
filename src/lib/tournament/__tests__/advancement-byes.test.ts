/**
 * Stage advancement and clinch scenarios use the real standings, so a stored
 * Swiss bye (a win) counts in them as it does in the stage's own table.
 * (advancement.test.ts mocks computeStandings; this file does not.)
 */
import { describe, expect, it } from 'vitest';
import type { AdvancementRule, TournamentGroupWithMembers } from '@/types/season';
import { computeAdvancement } from '../advancement';
import { computeClinchScenarios } from '../clinch-scenarios';
import type { ByeRecord, MatchRecord } from '../types';

const names = { a: 'A', b: 'B', c: 'C', d: 'D', e: 'E' };
const ids = ['a', 'b', 'c', 'd', 'e'];
// a beat b, c beat d; e sat out round 1.
const matches: MatchRecord[] = [
  { player_1_id: 'a', player_2_id: 'b', winner_id: 'a', round_number: 1 },
  { player_1_id: 'c', player_2_id: 'd', winner_id: 'c', round_number: 1 },
];
const byes: ByeRecord[] = [{ player_id: 'e', round_number: 1 }];
const top3: AdvancementRule = { type: 'top_n', count: 3, per_group: false };

describe('computeAdvancement with stored byes', () => {
  it('lets a bye win count toward the top N, as in the stage table', () => {
    // a, c and e each have one win: with the bye e is in the top 3 and not last.
    const withBye = computeAdvancement(top3, ids, names, matches, undefined, byes);
    const without = computeAdvancement(top3, ids, names, matches);

    expect(withBye.advancing_player_ids).toContain('e');
    expect(without.advancing_player_ids).not.toContain('e');
  });

  it('applies the byes inside a group table too', () => {
    const group = {
      id: 'g1',
      members: ['a', 'b', 'e'].map((player_id) => ({ player_id })),
    } as unknown as TournamentGroupWithMembers;
    const rule: AdvancementRule = { type: 'top_n', count: 2, per_group: true };

    const result = computeAdvancement(rule, ids, names, matches, [group], byes);

    expect(result.advancing_player_ids.sort()).toEqual(['a', 'e']);
  });

  it('is unchanged without byes', () => {
    expect(computeAdvancement(top3, ids, names, matches, undefined, [])).toEqual(
      computeAdvancement(top3, ids, names, matches),
    );
  });
});

describe('computeClinchScenarios with stored byes', () => {
  it('counts the bye win in the current rank', () => {
    const withBye = computeClinchScenarios(ids, names, matches, [], 3, byes);
    const without = computeClinchScenarios(ids, names, matches, [], 3);

    const rankOf = (rows: typeof withBye, id: string) => rows.find((r) => r.playerId === id)!.currentRank;
    expect(rankOf(withBye, 'e')).toBeLessThan(rankOf(without, 'e'));
  });
});
