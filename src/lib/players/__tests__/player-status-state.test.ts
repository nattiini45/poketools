import { describe, expect, it } from 'vitest';
import { IllegalTransitionError, specProblems } from '@/lib/state-machine/machine';
import { playerStatusMachine } from '../player-status-state';

describe('playerStatusMachine', () => {
  it('is a sound spec', () => {
    expect(specProblems(playerStatusMachine.spec)).toEqual([]);
  });

  it('suspends and bans only an active player', () => {
    expect(playerStatusMachine.sourcesOf('suspended', 'admin')).toEqual(['active']);
    expect(playerStatusMachine.sourcesOf('banned', 'admin')).toEqual(['active']);
  });

  it('reinstates a suspended or banned player, never an active one', () => {
    expect(playerStatusMachine.sourcesOf('active', 'admin')).toEqual(['suspended', 'banned']);
  });

  it('lets the cron lift only a suspension, matching the WHERE of clearExpiredSuspensions', () => {
    expect(playerStatusMachine.sourcesOf('active', 'system')).toEqual(['suspended']);
    expect(playerStatusMachine.can('banned', 'active', 'system')).toBe(false);
  });

  it('offers the roster actions for each status', () => {
    const events = (status: 'active' | 'suspended' | 'banned') =>
      playerStatusMachine.transitionsFrom(status, 'admin').map((t) => t.event);
    expect(events('active')).toEqual(['suspend', 'ban']);
    expect(events('suspended')).toEqual(['reinstate']);
    expect(events('banned')).toEqual(['reinstate']);
  });

  it.each([
    ['banned', 'suspended'],
    ['suspended', 'banned'],
    ['suspended', 'suspended'],
    ['banned', 'banned'],
    ['active', 'active'],
  ] as const)('refuses %s → %s with a 409', (from, to) => {
    let thrown: unknown;
    try {
      playerStatusMachine.assertTransition(from, to, 'admin');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(IllegalTransitionError);
    expect(thrown).toMatchObject({ statusCode: 409, code: 'state_transition_invalid', params: { machine: 'player.status', from, to } });
  });

  it('refuses a system move other than the expiry with a 403', () => {
    expect(() => playerStatusMachine.assertTransition('active', 'banned', 'system')).toThrow(
      expect.objectContaining({ statusCode: 403, code: 'state_transition_forbidden' }),
    );
  });
});
