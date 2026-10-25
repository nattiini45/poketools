/**
 * Clinch scenarios use the real standings, so a stored Swiss bye (a win) counts in them as it does in the
 * stage's own table. (Stage advancement with byes is covered in enrollment-sync-groups.test.ts; the
 * mocked-standings clinch tests live in clinch-scenarios.test.ts.)
 */
import { describe, expect, it } from 'vitest';
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

describe('computeClinchScenarios with stored byes', () => {
  it('counts the bye win in the current rank', () => {
    const withBye = computeClinchScenarios(ids, names, matches, [], 3, byes);
    const without = computeClinchScenarios(ids, names, matches, [], 3);

    const rankOf = (rows: typeof withBye, id: string) => rows.find((r) => r.playerId === id)!.currentRank;
    expect(rankOf(withBye, 'e')).toBeLessThan(rankOf(without, 'e'));
  });
});
