import { describe, expect, it } from 'vitest';
import type { MatchStatus } from '@/types/match';
import { AUTO_CONFIRM_FROM, matchEventSources, matchMachine, validateTransition } from '../match-state';

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

// The app's own moves (crons and the game pipeline) are not validateTransition's: they are checked against the
// definition directly. This pins them.
describe('matchMachine system moves', () => {
  const expected: Record<string, MatchStatus[]> = {
    scheduled: ['completed', 'in_progress', 'pending_confirmation', 'scheduled'],
    in_progress: ['completed', 'disputed', 'in_progress', 'pending_confirmation', 'scheduled'],
    pending_confirmation: ['completed', 'in_progress', 'pending_confirmation', 'scheduled'],
    completed: ['in_progress', 'pending_confirmation', 'scheduled'],
    disputed: ['in_progress', 'pending_confirmation', 'scheduled'],
  };

  it.each(STATUSES)('%s', (from) => {
    expect(matchMachine.nextStates(from, 'system').sort()).toEqual(expected[from]);
  });

  it('auto-confirms only a pending result, and the cron guards its write with that status', () => {
    expect(matchEventSources('auto_confirm')).toEqual(['pending_confirmation']);
    expect(AUTO_CONFIRM_FROM).toBe('pending_confirmation');
  });

  it('forfeits only a match that is not decided yet', () => {
    expect(matchEventSources('forfeit')).toEqual(['scheduled', 'in_progress']);
  });

  it('flags an engine tie only on a running series', () => {
    expect(matchMachine.sourcesOf('disputed', 'system')).toEqual(['in_progress']);
  });

  it('refuses a system move into disputed from a pending result (a person disputes it)', () => {
    expect(matchMachine.check('pending_confirmation', 'disputed', 'system')).toEqual({ ok: false, reason: 'actor_not_allowed' });
  });
});

