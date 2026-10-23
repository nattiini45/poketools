import type { BracketType } from '@/types/tournament';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
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
    for (const playerId of round.bye_player_ids ?? []) {
      records.push({ player_id: playerId, round_number: round.round_number });
    }
  }
  return records;
}

/**
 * Whether a league format scores Swiss byes at all. Evolution Point Buy never does, whatever its stages are: its
 * tables, previews, insights and generated text carry no bye. `null` (a standalone tournament) and an unknown
 * format score them. The one gate every surface that reads byes asks, so none disagrees with another.
 */
export function formatScoresByes(formatType: string | null | undefined): boolean {
  return !formatType || !isEvolutionPointBuy(formatType);
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

/**
 * The byes that count in a season-wide table: every stage's scoring byes, each by the rule of the stage it
 * belongs to (only a Swiss stage scores). `roundsByStage` holds the stored rounds per stage id; a missing id means
 * the stage has none.
 */
export function scoringByeRecordsForStages(
  stages: readonly { id: string; bracket_type?: BracketType | null }[],
  roundsByStage: ReadonlyMap<string, readonly RoundByeSource[]>,
): ByeRecord[] {
  return stages.flatMap((stage) => scoringByeRecords(stage.bracket_type, roundsByStage.get(stage.id) ?? []));
}

/**
 * Rounds grouped by the stage (tournament) they belong to, in input order. A stage without a round is absent from
 * the map. Pure: shared by the server loader and by readers that hold the rounds as cached JSON.
 */
export function groupRoundsByStage<R extends { tournament_id: string }>(rounds: readonly R[]): Map<string, R[]> {
  const byStage = new Map<string, R[]>();
  for (const round of rounds) {
    const stageRounds = byStage.get(round.tournament_id);
    if (stageRounds) stageRounds.push(round);
    else byStage.set(round.tournament_id, [round]);
  }
  return byStage;
}

/** How many scoring byes each player holds, by player id. */
export function countByesByPlayer(byes: readonly ByeRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const bye of byes) counts[bye.player_id] = (counts[bye.player_id] ?? 0) + 1;
  return counts;
}

/**
 * A win-loss record as text ("3W-1L-1D"). A bye counts in `wins` without a match behind it, so a record that
 * holds byes says so ("3W-1L, incl. 1 bye win without a match"): text built from the record then reconciles with
 * the match list.
 */
export function formatRecord(wins: number, losses: number, draws: number, byeWins = 0): string {
  const record = `${wins}W-${losses}L${draws > 0 ? `-${draws}D` : ''}`;
  if (byeWins <= 0) return record;
  return `${record}, incl. ${byeWins} bye win${byeWins === 1 ? '' : 's'} without a match`;
}
