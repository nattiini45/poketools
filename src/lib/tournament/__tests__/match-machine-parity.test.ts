import { describe, expect, it } from 'vitest';
import type { MatchStatus } from '@/types/match';
import { matchMachine, validateTransition } from '../match-state';

const STATUSES: MatchStatus[] = ['scheduled', 'in_progress', 'pending_confirmation', 'completed', 'disputed'];
const pairs = STATUSES.flatMap((from) => STATUSES.map((to) => [from, to] as const));

// The match machine's definition is documentation and UI data; validateTransition
// is what writers enforce. They must agree on every move for every actor.
describe('matchMachine parity with validateTransition', () => {
  it('declares the same states as the enum', () => {
    expect([...matchMachine.spec.states].sort()).toEqual([...STATUSES].sort());
  });

  it.each(pairs)('%s → %s', (from, to) => {
    const base = { actor_id: 'p1', winner_id: 'p1', player_1_id: 'p1', player_2_id: 'p2' };
    expect(matchMachine.can(from, to, 'player')).toBe(validateTransition(from, to, { ...base, is_admin: false }).valid);
    expect(matchMachine.can(from, to, 'admin')).toBe(validateTransition(from, to, { ...base, is_admin: true }).valid);
  });
});
