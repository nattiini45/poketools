/**
 * The rules of a challenge ladder (`pairing.challenge`), as pure checks. The database (`format_challenge_create`) is the
 * authority and enforces the same rules atomically under a lock; these functions are its twin for previews (who may this
 * player challenge now?) and for tests, and they raise the same codes in the same order.
 *
 * - A challenge goes up the ladder: the defender ranks above the challenger, at most `rank_range` places.
 * - At most `max_open` challenges of one challenger are open at a time, and one pair has at most one open challenge.
 * - The same challenger may challenge the same defender again only `cooldown_rounds` rounds after the earlier challenge
 *   (a withdrawn challenge does not count).
 * - A challenge is open until `accept_window_hours` have passed; then it counts as expired.
 *
 * Pure and client-safe.
 */
import type { Pairing } from '@/lib/format-kit/types';

export type ChallengePairing = Extract<Pairing, { kind: 'challenge' }>;

/** The pairing of a stage when it is a challenge ladder. */
export function challengeOf(pairing: Pairing): ChallengePairing | null {
  return pairing.kind === 'challenge' ? pairing : null;
}

export type ChallengeStatus = 'open' | 'accepted' | 'declined' | 'expired' | 'cancelled';

/** The fields of a stored challenge the rules read. */
export interface ChallengeRecord {
  challenger_id: string;
  defender_id: string;
  status: ChallengeStatus;
  round: number;
  expires_at: string;
}

export type ChallengeViolation =
  | 'challenge_self'
  | 'challenge_rank_range'
  | 'challenge_already_open'
  | 'challenge_max_open'
  | 'challenge_cooldown';

export interface ChallengeAttempt {
  challenger: string;
  defender: string;
  /** Places in the stage standings (1 = first). */
  challengerRank: number;
  defenderRank: number;
  /** The phase's open round. */
  round: number;
  now: Date;
}

/** An open challenge whose accept window has not run out: the only kind that blocks or counts. */
function isLive(challenge: ChallengeRecord, now: Date): boolean {
  return challenge.status === 'open' && new Date(challenge.expires_at).getTime() > now.getTime();
}

/** The first rule the attempt breaks, or null when the challenge may be made. `history` holds the phase's challenges. */
export function validateChallenge(
  config: Pick<ChallengePairing, 'rank_range' | 'max_open' | 'cooldown_rounds'>,
  attempt: ChallengeAttempt,
  history: readonly ChallengeRecord[],
): ChallengeViolation | null {
  if (attempt.challenger === attempt.defender) return 'challenge_self';
  const distance = attempt.challengerRank - attempt.defenderRank;
  if (distance < 1 || distance > config.rank_range) return 'challenge_rank_range';

  const live = history.filter((challenge) => isLive(challenge, attempt.now));
  const samePair = (c: ChallengeRecord) =>
    (c.challenger_id === attempt.challenger && c.defender_id === attempt.defender) ||
    (c.challenger_id === attempt.defender && c.defender_id === attempt.challenger);
  if (live.some(samePair)) return 'challenge_already_open';
  if (live.filter((c) => c.challenger_id === attempt.challenger).length >= config.max_open) return 'challenge_max_open';

  if (
    config.cooldown_rounds > 0 &&
    history.some(
      (c) =>
        c.challenger_id === attempt.challenger &&
        c.defender_id === attempt.defender &&
        c.status !== 'cancelled' &&
        attempt.round - c.round < config.cooldown_rounds,
    )
  ) {
    return 'challenge_cooldown';
  }
  return null;
}

/** The moment an accept window that opens at `now` runs out. */
export function challengeExpiry(config: Pick<ChallengePairing, 'accept_window_hours'>, now: Date): Date {
  return new Date(now.getTime() + config.accept_window_hours * 3_600_000);
}

export interface LadderRow {
  player_id: string;
  rank: number;
}

/**
 * The players `challenger` may challenge right now, best first: the ones ranked above them within `rank_range` that no
 * rule forbids. Empty when the challenger has no rank in the table.
 */
export function challengeTargets(
  config: Pick<ChallengePairing, 'rank_range' | 'max_open' | 'cooldown_rounds'>,
  table: readonly LadderRow[],
  challenger: string,
  round: number,
  history: readonly ChallengeRecord[],
  now: Date,
): LadderRow[] {
  const own = table.find((row) => row.player_id === challenger);
  if (own === undefined) return [];
  return table
    .filter(
      (row) =>
        validateChallenge(
          config,
          { challenger, defender: row.player_id, challengerRank: own.rank, defenderRank: row.rank, round, now },
          history,
        ) === null,
    )
    .sort((a, b) => a.rank - b.rank);
}
