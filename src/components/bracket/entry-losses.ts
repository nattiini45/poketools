import type { PublicMatch } from '@/lib/match/public-match';
import type { PublicTournamentParticipant } from '@/lib/players/public-player';
import type { Round } from '@/types/round';

/** Each entrant's losses going into one match, by player slot. */
export interface EntryLosses {
  player1: number;
  player2: number;
}

type LossMatch = Pick<
  PublicMatch,
  'id' | 'round_id' | 'bracket_pos' | 'player_1_id' | 'player_2_id' | 'winner_id' | 'status'
>;

/**
 * The losses each entrant carried INTO each match of a double-elimination
 * bracket: a losers-side starter's nominal loss (the engine's
 * `computeBracketState` gives them one) plus every completed match they lost
 * before this one. A card shows what decided the pairing, not the player's
 * count today: the Winners Final loser reads 0 on the Winners Final and 1 on
 * the Losers Final, and the Grand Final shows 0 against 1, which is why the
 * reset is needed when the 1-loss entrant wins it.
 *
 * "Before" is the bracket's order: the global round number, then the bracket
 * position (the Grand Final and its reset share a round; the Grand Final is
 * position 0, the reset 1). A player plays once per round otherwise, so
 * matches in one round never see each other's results. A match's own result
 * never counts towards its own entry.
 *
 * Plain data (string keys, numbers): it crosses into the client renderer.
 */
export function lossesEnteringMatches(
  rounds: readonly Pick<Round, 'id' | 'round_number'>[],
  matches: readonly LossMatch[],
  participants: readonly Pick<PublicTournamentParticipant, 'id' | 'starting_bracket'>[],
): Record<string, EntryLosses> {
  const roundNumber = new Map(rounds.map((round) => [round.id, round.round_number]));
  const losses = new Map<string, number>();
  for (const participant of participants) {
    if (participant.starting_bracket === 'losers') losses.set(participant.id, 1);
  }

  const ordered = matches
    .map((match, index) => ({ match, index }))
    .filter(({ match }) => roundNumber.has(match.round_id))
    .sort(
      (a, b) =>
        roundNumber.get(a.match.round_id)! - roundNumber.get(b.match.round_id)! ||
        (a.match.bracket_pos ?? 0) - (b.match.bracket_pos ?? 0) ||
        a.index - b.index,
    );

  const entry: Record<string, EntryLosses> = {};
  for (const { match } of ordered) {
    entry[match.id] = {
      player1: losses.get(match.player_1_id) ?? 0,
      player2: losses.get(match.player_2_id) ?? 0,
    };
    if (match.status !== 'completed' || !match.winner_id) continue;
    const loser =
      match.winner_id === match.player_1_id
        ? match.player_2_id
        : match.winner_id === match.player_2_id
          ? match.player_1_id
          : null;
    if (loser) losses.set(loser, (losses.get(loser) ?? 0) + 1);
  }
  return entry;
}
