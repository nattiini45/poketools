import { describe, expect, it } from 'vitest';
import type { MatchStatus } from '@/types/match';
import { matchMachine, matchTimestampsFor } from '../match-state';

const NOW = '2026-11-09T12:00:00.000Z';
const STATUSES: MatchStatus[] = ['scheduled', 'in_progress', 'pending_confirmation', 'completed', 'disputed'];

describe('matchTimestampsFor', () => {
  it('clears the finalize marker on every move of the machine', () => {
    for (const t of matchMachine.spec.transitions) {
      for (const from of t.from) expect(matchTimestampsFor(from, t.to).finalized_at).toBeNull();
    }
  });

  it.each(STATUSES)('%s → completed: confirmed and played now, no deadline', (from) => {
    expect(matchTimestampsFor(from, 'completed', { now: NOW })).toEqual({
      finalized_at: null,
      confirmed_at: NOW,
      date_played: NOW,
      auto_confirm_at: null,
    });
  });

  it.each(STATUSES)('%s → scheduled: no result timestamps', (from) => {
    expect(matchTimestampsFor(from, 'scheduled')).toEqual({
      finalized_at: null,
      confirmed_at: null,
      date_played: null,
      auto_confirm_at: null,
    });
  });

  it('into pending_confirmation: the deadline given, none otherwise; staying pending keeps the deadline', () => {
    expect(matchTimestampsFor('in_progress', 'pending_confirmation', { autoConfirmAt: NOW })).toEqual({
      finalized_at: null,
      auto_confirm_at: NOW,
      confirmed_at: null,
    });
    expect(matchTimestampsFor('in_progress', 'pending_confirmation').auto_confirm_at).toBeNull();
    expect(matchTimestampsFor('pending_confirmation', 'pending_confirmation', { autoConfirmAt: NOW })).toEqual({
      finalized_at: null,
    });
  });

  it('into in_progress: the first game changes nothing, a move back from a result clears it', () => {
    expect(matchTimestampsFor('scheduled', 'in_progress')).toEqual({ finalized_at: null });
    for (const from of ['pending_confirmation', 'completed', 'disputed'] as const) {
      expect(matchTimestampsFor(from, 'in_progress')).toEqual({
        finalized_at: null,
        auto_confirm_at: null,
        confirmed_at: null,
        date_played: null,
      });
    }
  });

  it('into disputed from a running series: the deadline stops', () => {
    expect(matchTimestampsFor('in_progress', 'disputed')).toEqual({ finalized_at: null, auto_confirm_at: null });
  });
});
