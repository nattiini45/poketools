import { describe, expect, it } from 'vitest';
import { seasonMachine } from '@/lib/season/season-state';
import { leaguePrimaryAction, type LeaguePrimaryActionInput } from '../primary-action';

const ID = '5e150000-0000-4000-8000-000000000001';

function input(overrides: Partial<LeaguePrimaryActionInput> = {}): LeaguePrimaryActionInput {
  return {
    id: ID,
    status: 'upcoming',
    archived: false,
    formatType: 'singles',
    participantCount: 8,
    phaseCount: 1,
    activateBlocked: false,
    ...overrides,
  };
}

describe('leaguePrimaryAction', () => {
  it('a league that is set up and not started: Activate, to the state the machine names', () => {
    const start = seasonMachine.transitionsFrom('upcoming', 'admin').find((move) => move.event === 'start');
    expect(leaguePrimaryAction(input())).toEqual({ id: 'activate', kind: 'status', to: start?.to });
  });

  it('a custom league without a format links to the attach panel instead of a blocked Activate', () => {
    expect(leaguePrimaryAction(input({ formatType: 'custom', activateBlocked: true, participantCount: 0 }))).toEqual({
      id: 'attachFormat',
      kind: 'link',
      href: `/admin/leagues/${ID}?tab=format#format-attach`,
    });
  });

  it('no participants yet: the Participants tab', () => {
    expect(leaguePrimaryAction(input({ participantCount: 0, phaseCount: 0 }))).toEqual({
      id: 'addParticipants',
      kind: 'link',
      href: `/admin/leagues/${ID}?tab=participants`,
    });
  });

  it('no phase yet: the Phases tab; a custom league gets its phases from the format, so it is offered Activate', () => {
    expect(leaguePrimaryAction(input({ phaseCount: 0 }))).toEqual({ id: 'addPhase', kind: 'link', href: `/admin/leagues/${ID}?tab=phases` });
    expect(leaguePrimaryAction(input({ formatType: 'custom', phaseCount: 0 }))?.id).toBe('activate');
  });

  it('a running league links to its rounds, a running custom league to its checks inbox', () => {
    expect(leaguePrimaryAction(input({ status: 'active' }))).toEqual({ id: 'manageRounds', kind: 'link', href: `/admin/leagues/${ID}?tab=phases` });
    expect(leaguePrimaryAction(input({ status: 'active', formatType: 'custom' }))).toEqual({
      id: 'reviewChecks',
      kind: 'link',
      href: `/admin/leagues/${ID}?tab=live`,
    });
  });

  it('a completed league links to its public page', () => {
    expect(leaguePrimaryAction(input({ status: 'completed' }))).toEqual({ id: 'publicPage', kind: 'link', href: `/leagues/${ID}` });
  });

  it('an archived league has no primary action, whatever its status', () => {
    for (const status of seasonMachine.spec.states) expect(leaguePrimaryAction(input({ status, archived: true })), status).toBeNull();
  });

  it('Activate is offered only where the machine lets an admin start the league', () => {
    for (const status of seasonMachine.spec.states) {
      const canStart = seasonMachine.transitionsFrom(status, 'admin').some((move) => move.event === 'start');
      expect(leaguePrimaryAction(input({ status }))?.id === 'activate', status).toBe(canStart);
    }
  });
});
