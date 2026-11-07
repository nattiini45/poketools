import { describe, expect, it } from 'vitest';
import {
  challengeExpiry,
  challengeOf,
  challengeTargets,
  validateChallenge,
  type ChallengeAttempt,
  type ChallengeRecord,
} from '../challenge';

const config = { rank_range: 2, max_open: 1, cooldown_rounds: 2 };
const now = new Date('2026-11-06T12:00:00Z');
const future = '2026-11-07T12:00:00Z';
const past = '2026-11-05T12:00:00Z';

const attempt = (over: Partial<ChallengeAttempt> = {}): ChallengeAttempt => ({
  challenger: 'c',
  defender: 'b',
  challengerRank: 3,
  defenderRank: 2,
  round: 4,
  now,
  ...over,
});
const challenge = (over: Partial<ChallengeRecord> = {}): ChallengeRecord => ({
  challenger_id: 'c',
  defender_id: 'a',
  status: 'open',
  round: 4,
  expires_at: future,
  ...over,
});

describe('validateChallenge', () => {
  it('allows a challenge up the ladder within the range', () => {
    expect(validateChallenge(config, attempt(), [])).toBeNull();
    expect(validateChallenge(config, attempt({ defenderRank: 1 }), [])).toBeNull();
  });

  it('refuses a self challenge, a player below and one beyond the range', () => {
    expect(validateChallenge(config, attempt({ defender: 'c' }), [])).toBe('challenge_self');
    expect(validateChallenge(config, attempt({ defenderRank: 4 }), [])).toBe('challenge_rank_range');
    expect(validateChallenge(config, attempt({ challengerRank: 5, defenderRank: 2 }), [])).toBe('challenge_rank_range');
  });

  it('counts only live open challenges against max_open', () => {
    expect(validateChallenge(config, attempt(), [challenge()])).toBe('challenge_max_open');
    expect(validateChallenge(config, attempt(), [challenge({ expires_at: past })])).toBeNull();
    expect(validateChallenge(config, attempt(), [challenge({ status: 'declined', round: 1 })])).toBeNull();
    expect(validateChallenge({ ...config, max_open: 2 }, attempt(), [challenge()])).toBeNull();
  });

  it('refuses a second open challenge between one pair, whoever made the first', () => {
    const reverse = challenge({ challenger_id: 'b', defender_id: 'c' });
    expect(validateChallenge({ ...config, max_open: 3 }, attempt(), [reverse])).toBe('challenge_already_open');
  });

  it('holds the cooldown for the same pair, not for a withdrawn challenge', () => {
    const earlier = challenge({ defender_id: 'b', status: 'declined', round: 3 });
    expect(validateChallenge(config, attempt(), [earlier])).toBe('challenge_cooldown');
    expect(validateChallenge(config, attempt({ round: 5 }), [earlier])).toBeNull();
    expect(validateChallenge(config, attempt(), [{ ...earlier, status: 'cancelled' }])).toBeNull();
    expect(validateChallenge({ ...config, cooldown_rounds: 0 }, attempt(), [earlier])).toBeNull();
  });
});

describe('challengeTargets', () => {
  const table = [1, 2, 3, 4, 5].map((rank) => ({ player_id: `p${rank}`, rank }));

  it('lists the players above within the range, best first', () => {
    expect(challengeTargets(config, table, 'p4', 1, [], now).map((r) => r.player_id)).toEqual(['p2', 'p3']);
  });

  it('is empty for the leader and for a player not in the table', () => {
    expect(challengeTargets(config, table, 'p1', 1, [], now)).toEqual([]);
    expect(challengeTargets(config, table, 'zz', 1, [], now)).toEqual([]);
  });
});

describe('challengeExpiry and challengeOf', () => {
  it('adds the accept window in hours', () => {
    expect(challengeExpiry({ accept_window_hours: 72 }, now).toISOString()).toBe('2026-11-09T12:00:00.000Z');
  });

  it('reads only a challenge pairing', () => {
    const pairing = { kind: 'challenge', rounds: 3, rank_range: 2, max_open: 1, cooldown_rounds: 1, accept_window_hours: 72 } as const;
    expect(challengeOf(pairing)).toBe(pairing);
    expect(challengeOf({ kind: 'manual' })).toBeNull();
  });
});
