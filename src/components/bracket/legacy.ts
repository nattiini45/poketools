import type { Round } from '@/types/round';
import type { MatchWithPlayers } from '@/types/match';

type BracketRoundLike = Pick<Round, 'bracket_side'>;
type BracketMatchLike = Pick<MatchWithPlayers, 'bracket_pos'>;

/**
 * True when elim bracket rows predate the structure engine (no `bracket_side`
 * on rounds and/or no `bracket_pos` on matches). Zero rounds is NOT legacy —
 * new tournaments use the bracket-engine UI and slot rendering.
 */
export function isLegacyElimBracketData(
  rounds: BracketRoundLike[],
  matches: BracketMatchLike[] = [],
): boolean {
  if (rounds.length === 0) {
    return false;
  }

  if (rounds.some((r) => r.bracket_side != null)) {
    return false;
  }

  if (matches.length > 0 && !matches.some((m) => m.bracket_pos != null)) {
    return true;
  }

  return true;
}
