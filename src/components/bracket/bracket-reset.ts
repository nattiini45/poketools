import type { BracketSlotDef } from '@/lib/tournament/bracket-structure';
import type { PublicMatch } from '@/lib/match/public-match';
import type { Round } from '@/types/round';

type SlotMatch = Pick<PublicMatch, 'round_id' | 'bracket_pos' | 'status' | 'winner_id'>;

/** The match that fills a slot: same side and global round (via its round row), same bracket position. */
function matchInSlot(
  slot: BracketSlotDef,
  rounds: readonly Pick<Round, 'id' | 'round_number' | 'bracket_side'>[],
  matches: readonly SlotMatch[],
): SlotMatch | null {
  const roundIds = new Set(
    rounds
      .filter((round) => round.bracket_side === slot.bracket_side && round.round_number === slot.global_round_number)
      .map((round) => round.id),
  );
  return matches.find((match) => roundIds.has(match.round_id) && match.bracket_pos === slot.bracket_pos) ?? null;
}

/**
 * The double-elimination bracket-reset slots that will never be played: the
 * Grand Final is completed and its winner is the winners-bracket entrant (the
 * winner of the Winners Final, its first feeder), so nobody needs a second
 * loss. The renderer drops these slots instead of drawing an "(if necessary)"
 * skeleton under a finished bracket.
 *
 * With the tournament's reset switched off (`bracketResetEnabled` false,
 * `tournaments.bracket_reset_enabled`), every reset slot without a match is
 * dropped too. A reset match already in the slot always stays: switching the
 * reset off deletes only an unplayed one, so a played reset keeps rendering.
 *
 * Otherwise a reset slot stays whenever the outcome is unknown or the reset is
 * needed: the Grand Final is unplayed, the losers-bracket entrant won it, or
 * the Winners Final has no match row to name the entrant.
 */
export function unneededResetSlotKeys(
  slots: readonly BracketSlotDef[],
  rounds: readonly Pick<Round, 'id' | 'round_number' | 'bracket_side'>[],
  matches: readonly SlotMatch[],
  bracketResetEnabled = true,
): Set<string> {
  const unneeded = new Set<string>();
  const byKey = new Map(slots.map((slot) => [slot.slotKey, slot]));
  for (const reset of slots) {
    if (!reset.isBracketReset) continue;
    if (matchInSlot(reset, rounds, matches)) continue;
    if (!bracketResetEnabled) {
      unneeded.add(reset.slotKey);
      continue;
    }
    if (reset.feeder1.kind !== 'winner' || !reset.feeder1.slotKey) continue;
    const grandFinal = byKey.get(reset.feeder1.slotKey);
    if (!grandFinal || grandFinal.feeder1.kind !== 'winner' || !grandFinal.feeder1.slotKey) continue;
    const winnersFinal = byKey.get(grandFinal.feeder1.slotKey);
    if (!winnersFinal) continue;
    const gfMatch = matchInSlot(grandFinal, rounds, matches);
    const wfMatch = matchInSlot(winnersFinal, rounds, matches);
    if (gfMatch?.status !== 'completed' || !gfMatch.winner_id) continue;
    if (wfMatch?.status !== 'completed' || !wfMatch.winner_id) continue;
    if (gfMatch.winner_id === wfMatch.winner_id) unneeded.add(reset.slotKey);
  }
  return unneeded;
}
