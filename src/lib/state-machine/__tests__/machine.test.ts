import { describe, expect, it } from 'vitest';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { defineMachine, IllegalTransitionError, specProblems, type MachineSpec } from '../machine';

const door = defineMachine({
  id: 'door',
  title: 'Door',
  storage: 'test',
  summary: 'test machine',
  states: ['closed', 'open', 'locked', 'gone'],
  initial: ['closed'],
  terminal: ['gone'],
  actors: ['guest', 'owner'],
  transitions: [
    { event: 'open', from: ['closed'], to: 'open', actors: ['guest', 'owner'], writers: ['a.ts'] },
    { event: 'close', from: ['open'], to: 'closed', actors: ['guest', 'owner'], writers: ['a.ts'] },
    { event: 'lock', from: ['closed'], to: 'locked', actors: ['owner'], writers: ['a.ts'] },
    { event: 'unlock', from: ['locked'], to: 'closed', actors: ['owner'], writers: ['a.ts'] },
    { event: 'remove', from: ['closed', 'locked'], to: 'gone', actors: ['owner'], writers: ['a.ts'] },
  ],
});

describe('defineMachine', () => {
  it('recognises declared states only', () => {
    expect(door.isState('open')).toBe(true);
    expect(door.isState('constructor')).toBe(false);
    expect(door.isState('__proto__')).toBe(false);
    expect(door.isState(undefined)).toBe(false);
  });

  it('lists next states and transitions, per actor', () => {
    expect(door.nextStates('closed')).toEqual(['open', 'locked', 'gone']);
    expect(door.nextStates('closed', 'guest')).toEqual(['open']);
    expect(door.transitionsFrom('locked', 'guest')).toEqual([]);
    expect(door.transitionsFrom('locked', 'owner').map((t) => t.event)).toEqual(['unlock', 'remove']);
    expect(door.nextStates('gone')).toEqual([]);
  });

  it('gives the source states of a target for a compare-and-set guard', () => {
    expect(door.sourcesOf('gone')).toEqual(['closed', 'locked']);
    expect(door.sourcesOf('gone', 'guest')).toEqual([]);
    expect(door.sourcesOf('closed', 'guest')).toEqual(['open']);
  });

  it('checks a move and names the reason', () => {
    expect(door.check('closed', 'open', 'guest')).toMatchObject({ ok: true, transition: { event: 'open' } });
    expect(door.check('open', 'locked', 'owner')).toEqual({ ok: false, reason: 'not_a_transition' });
    expect(door.check('closed', 'locked', 'guest')).toEqual({ ok: false, reason: 'actor_not_allowed' });
    expect(door.check('ajar' as 'open', 'open', 'guest')).toEqual({ ok: false, reason: 'unknown_state' });
    expect(door.can('closed', 'locked', 'owner')).toBe(true);
    expect(door.can('closed', 'closed', 'owner')).toBe(false);
  });

  it('throws a catalogued, user-facing error: 409 for an invalid move, 403 for the wrong actor', () => {
    expect(door.assertTransition('closed', 'open', 'guest').event).toBe('open');
    try {
      door.assertTransition('gone', 'closed', 'owner');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalTransitionError);
      expect(error).toBeInstanceOf(UserFacingError);
      expect(error).toMatchObject({
        statusCode: 409,
        code: 'state_transition_invalid',
        params: { machine: 'door', from: 'gone', to: 'closed' },
        reason: 'not_a_transition',
      });
    }
    expect(() => door.assertTransition('closed', 'locked', 'guest')).toThrow(
      expect.objectContaining({ statusCode: 403, code: 'state_transition_forbidden', reason: 'actor_not_allowed' }),
    );
  });

  it('uses the machine\'s own catalog codes when it names them', () => {
    const custom = defineMachine({ ...door.spec, codes: { invalid: 'match_transition_invalid' } });
    expect(() => custom.assertTransition('gone', 'open', 'owner')).toThrow(
      expect.objectContaining({ code: 'match_transition_invalid', params: { machine: 'door', from: 'gone', to: 'open' } }),
    );
  });
});

describe('specProblems', () => {
  it('passes a sound spec', () => {
    expect(specProblems(door.spec)).toEqual([]);
  });

  it('names every structural problem', () => {
    const broken: MachineSpec<string, string> = {
      ...door.spec,
      states: ['closed', 'open', 'gone', 'orphan'],
      transitions: [
        { event: 'open', from: ['closed'], to: 'open', actors: ['guest'], writers: ['a.ts'] },
        { event: 'open_again', from: ['closed'], to: 'open', actors: ['guest'], writers: ['a.ts'] },
        { event: 'revive', from: ['gone'], to: 'closed', actors: ['owner'], writers: ['a.ts'] },
        { event: 'jump', from: ['open'], to: 'nowhere', actors: ['ghost'], writers: [] },
      ],
    };
    expect(specProblems(broken)).toEqual([
      'closed→open:guest is declared twice',
      'terminal state gone has outgoing transition revive',
      'jump names no writer',
      'jump targets undeclared state nowhere',
      'jump names undeclared actor ghost',
      'state gone is unreachable',
      'state orphan is unreachable',
    ]);
  });
});
