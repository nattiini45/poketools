import type { Pairing, GeneratedRound, MatchRecord, ByeRecord } from './types';
import { BYE_PLAYER_ID } from './types';
import { computeStandings, buildPairingHistory, havePlayed } from './standings';

/**
 * How many search steps each pairing search of a round may spend: the bye-candidate pass and the fewest-rematches fallback
 * each get this budget. A search that runs out settles for the best pairing found (or greedy).
 */
export const SWISS_SEARCH_STEP_LIMIT = 200_000;

type PairingHistory = ReturnType<typeof buildPairingHistory>;

interface Matching {
  pairs: Array<[string, string]>;
  rematches: number;
}

/**
 * The pairing of `players` (in standings order) with the fewest rematches, preferring higher-ranked opponents: a depth-first
 * search that always pairs the highest-ranked unpaired player first and tries opponents in standings order. With
 * `maxRematches` = 0 it returns the first rematch-free pairing in that order: the top-down Monrad pairing whenever that
 * pairing has no rematch, else the nearest rematch-free one to it. `maxRematches` bounds the search; `budget` caps its steps. Returns null when no pairing within
 * the bound was found, or when the budget ran out before one was.
 */
function searchPairing(players: readonly string[], history: PairingHistory, maxRematches: number, budget: { steps: number }): Matching | null {
  const paired = new Set<string>();
  const pairs: Array<[string, string]> = [];
  let best: Matching | null = null;

  const visit = (rematches: number): boolean => {
    if (--budget.steps < 0) return true;
    const first = players.find((player) => !paired.has(player));
    if (first === undefined) {
      if (best === null || rematches < best.rematches) best = { pairs: [...pairs], rematches };
      // A pairing without rematches cannot be beaten: stop.
      return rematches === 0;
    }
    paired.add(first);
    for (const opponent of players) {
      if (paired.has(opponent)) continue;
      const cost = havePlayed(history, first, opponent) ? 1 : 0;
      const total = rematches + cost;
      if (total > maxRematches || (best !== null && total >= best.rematches)) continue;
      paired.add(opponent);
      pairs.push([first, opponent]);
      const stop = visit(total);
      pairs.pop();
      paired.delete(opponent);
      if (stop) {
        paired.delete(first);
        return true;
      }
    }
    paired.delete(first);
    return false;
  };

  visit(0);
  return best;
}

/** The old top-down pairing: next unpaired opponent who has not met the player, else simply the next one. */
function greedyPairing(players: readonly string[], history: PairingHistory): Matching {
  const paired = new Set<string>();
  const pairs: Array<[string, string]> = [];
  let rematches = 0;
  for (let i = 0; i < players.length; i++) {
    const p1 = players[i];
    if (paired.has(p1)) continue;
    let p2 = players.slice(i + 1).find((candidate) => !paired.has(candidate) && !havePlayed(history, p1, candidate));
    if (p2 === undefined) {
      p2 = players.slice(i + 1).find((candidate) => !paired.has(candidate));
      if (p2 === undefined) break;
      rematches += 1;
    }
    paired.add(p1);
    paired.add(p2);
    pairs.push([p1, p2]);
  }
  return { pairs, rematches };
}

/**
 * Swiss/Monrad pairing algorithm.
 *
 * 1. Compute standings from completed matches (and stored byes, which score as wins)
 * 2. Sort players by points (desc), then buchholz
 * 3. Pair top-vs-next within score groups, never repeating a pairing when any pairing of the round avoids it: the search
 *    backtracks instead of forcing the last players together (#39)
 * 4. Handle bye for odd player count: the lowest-ranked player who has not had one (`byeHistory` lists the byes stored on
 *    earlier rounds) whose removal still leaves a rematch-free pairing; then the lowest-ranked of the rest
 * 5. When no bye and pairing avoid every rematch: the lowest-ranked bye candidate sits out, and the others get the pairing
 *    with the fewest rematches (bounded search; greedy, logged, when the search ran out before beating it)
 */
export function generateSwissRound(
  participantIds: string[],
  participantNames: Record<string, string>,
  matchHistory: MatchRecord[],
  roundNumber: number,
  byeHistory: ByeRecord[] = [],
  /** Overrides `SWISS_SEARCH_STEP_LIMIT` (tests). */
  options: { stepLimit?: number } = {},
): GeneratedRound {
  const stepLimit = options.stepLimit ?? SWISS_SEARCH_STEP_LIMIT;
  const standings = computeStandings(
    participantIds,
    participantNames,
    matchHistory,
    {},
    { byes: byeHistory },
  );
  const history = buildPairingHistory(matchHistory, byeHistory);
  const ranked = standings.map((s) => s.player_id);

  // The bye candidates, best first: the lowest-ranked players without a bye, then the lowest-ranked with one.
  const byeCandidates: Array<string | null> =
    ranked.length % 2 === 0
      ? [null]
      : [
          ...[...ranked].reverse().filter((id) => !havePlayed(history, id, BYE_PLAYER_ID)),
          ...[...ranked].reverse().filter((id) => havePlayed(history, id, BYE_PLAYER_ID)),
        ];
  const without = (bye: string | null) => (bye === null ? ranked : ranked.filter((id) => id !== bye));

  const budget = { steps: stepLimit };
  let chosen: { bye: string | null; matching: Matching } | null = null;
  let tried = 0;
  // First: the best bye candidate that leaves a pairing without any rematch.
  for (const bye of byeCandidates) {
    tried += 1;
    const matching = searchPairing(without(bye), history, 0, budget);
    if (matching !== null) {
      chosen = { bye, matching };
      break;
    }
    if (budget.steps < 0) {
      // Not proven: a candidate not yet tried (or this one, further on) might still have allowed a clean round.
      console.warn(
        `[swiss] round ${roundNumber} of ${ranked.length} players: the rematch-free search hit its step limit after ` +
          `${tried} of ${byeCandidates.length} bye candidate(s); falling back to the first candidate and its best pairing`,
      );
      break;
    }
  }
  // Else: the first candidate's pairing with the fewest rematches, or greedy when the search ran out of steps.
  if (chosen === null) {
    const bye = byeCandidates[0];
    const fallbackBudget = { steps: stepLimit };
    const players = without(bye);
    const searched = searchPairing(players, history, players.length, fallbackBudget);
    const greedy = greedyPairing(players, history);
    const matching = searched !== null && searched.rematches <= greedy.rematches ? searched : greedy;
    // Only a result the search could not prove minimal is worth a line: a completed search's fallback is the best there is.
    if (fallbackBudget.steps < 0) {
      console.warn(
        `[swiss] round ${roundNumber} of ${ranked.length} players: the fewest-rematches search hit its step limit; ` +
          `${matching === greedy ? 'used the greedy pairing' : 'used the best pairing found'} (${matching.rematches} rematches)`,
      );
    }
    chosen = { bye, matching };
  }

  return {
    round_number: roundNumber,
    round_name: `Round ${roundNumber}`,
    pairings: chosen.matching.pairs.map(([player_1_id, player_2_id]): Pairing => ({ player_1_id, player_2_id })),
    bye_player_ids: chosen.bye === null ? [] : [chosen.bye],
  };
}
