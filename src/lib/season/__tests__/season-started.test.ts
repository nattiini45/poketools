import { describe, expect, it } from 'vitest';
import type { SeasonStatus } from '@/types/season';
import type { TournamentStatus } from '@/types/tournament';
import { isSeasonStarted } from '../season-started';

const phase = (status: TournamentStatus, rounds_total = 0) => ({ status, rounds_total });

describe('isSeasonStarted', () => {
  it.each<[SeasonStatus, boolean]>([
    ['upcoming', false],
    ['active', true],
    ['completed', true],
  ])('a league with status %s and no phases: started = %s', (status, expected) => {
    expect(isSeasonStarted({ status, phases: [] })).toBe(expected);
  });

  it('an upcoming league whose phases are all upcoming without rounds has not started', () => {
    expect(isSeasonStarted({ status: 'upcoming', phases: [phase('upcoming'), phase('upcoming')] })).toBe(false);
  });

  it.each<TournamentStatus>(['active', 'completed'])('any phase that is %s means started', (status) => {
    expect(isSeasonStarted({ status: 'upcoming', phases: [phase('upcoming'), phase(status)] })).toBe(true);
  });

  it('any phase with a round means started, even an upcoming one (a running league flipped back to upcoming)', () => {
    expect(isSeasonStarted({ status: 'upcoming', phases: [phase('upcoming', 0), phase('upcoming', 1)] })).toBe(true);
    expect(isSeasonStarted({ status: 'upcoming', phases: [phase('upcoming', 12)] })).toBe(true);
  });

  it('the league status wins over quiet phases', () => {
    expect(isSeasonStarted({ status: 'active', phases: [phase('upcoming')] })).toBe(true);
    expect(isSeasonStarted({ status: 'completed', phases: [] })).toBe(true);
  });

  it('only the status and the phases count: nothing else is part of the signals', () => {
    // Participants, draft pools and the like are deliberately not inputs of the rule.
    const signals = { status: 'upcoming' as const, phases: [], participants: 16, draftPools: 2 };
    expect(isSeasonStarted(signals)).toBe(false);
  });
});
