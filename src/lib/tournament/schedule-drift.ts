import { UserFacingError } from '@/lib/api/user-facing-error';
import type { MatchRecord, Pairing } from './types';

/**
 * An ungrouped round robin keeps no stored schedule: each round is rebuilt from the circle method over the current
 * participant order (seed, then name). A rename or a substitute between two generations changes that order, so the
 * rebuilt round would repeat a pairing that was already scheduled. HTTP 409, code `round_robin_schedule_drift`; the
 * manual round route is the escape hatch (it validates its pairings itself).
 */
export class RoundRobinScheduleDriftError extends UserFacingError {
  constructor(roundName: string) {
    super(
      `${roundName} would repeat a pairing that is already scheduled in this tournament. A participant was renamed or replaced after the first round; create this round by hand instead.`,
      { code: 'round_robin_schedule_drift', params: { round: roundName }, status: 409 },
    );
    this.name = 'RoundRobinScheduleDriftError';
  }
}

const pairKey = (a: string, b: string) => (a < b ? `${a}::${b}` : `${b}::${a}`);

/**
 * The first existing match (any status) between a pair of `pairings`, or null. `ignoreRoundNumber` skips the round
 * being written: a refilled round holds no match yet, and one that does is answered as already written.
 */
export function findScheduleDrift(
  pairings: readonly Pairing[],
  existing: readonly MatchRecord[],
  options: { ignoreRoundNumber?: number } = {},
): MatchRecord | null {
  const scheduled = new Map<string, MatchRecord>();
  for (const match of existing) {
    if (match.round_number === options.ignoreRoundNumber) continue;
    const key = pairKey(match.player_1_id, match.player_2_id);
    if (!scheduled.has(key)) scheduled.set(key, match);
  }
  for (const pairing of pairings) {
    const hit = scheduled.get(pairKey(pairing.player_1_id, pairing.player_2_id));
    if (hit) return hit;
  }
  return null;
}

/** Throws `RoundRobinScheduleDriftError` when a pairing of the round to write is already scheduled. */
export function assertNoScheduleDrift(
  roundName: string,
  pairings: readonly Pairing[],
  existing: readonly MatchRecord[],
  options: { ignoreRoundNumber?: number } = {},
): void {
  if (findScheduleDrift(pairings, existing, options)) throw new RoundRobinScheduleDriftError(roundName);
}
