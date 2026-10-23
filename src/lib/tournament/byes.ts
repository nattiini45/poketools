import type { BracketType } from '@/types/tournament';
import type { ByeRecord } from './types';

/** The fields of a stored round that carry its bye. */
export interface RoundByeSource {
  round_number: number;
  bye_player_ids: readonly string[];
}

/**
 * Every stored bye of a tournament's rounds, one record per bye player.
 * Used by pairing, which needs "has this player already had a bye".
 */
export function byeRecordsFromRounds(rounds: readonly RoundByeSource[]): ByeRecord[] {
  const records: ByeRecord[] = [];
  for (const round of rounds) {
    for (const playerId of round.bye_player_ids) {
      records.push({ player_id: playerId, round_number: round.round_number });
    }
  }
  return records;
}

/**
 * The byes that count in a stage's standings. Only a Swiss stage scores its
 * bye (as a win); a round robin bye is a rest round worth nothing, and an
 * elimination bye is structural. Every standings caller passes its rounds
 * through this gate, so the rule lives in one place.
 */
export function scoringByeRecords(
  bracketType: BracketType | null | undefined,
  rounds: readonly RoundByeSource[],
): ByeRecord[] {
  return bracketType === 'swiss' ? byeRecordsFromRounds(rounds) : [];
}
