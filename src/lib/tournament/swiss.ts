import type { Pairing, GeneratedRound, MatchRecord, ByeRecord } from './types';
import { BYE_PLAYER_ID } from './types';
import { computeStandings, buildPairingHistory, havePlayed } from './standings';

/** How many search steps one round may spend before it settles for the best pairing found (or greedy). */
export const SWISS_SEARCH_STEP_LIMIT = 200_000;

type PairingHistory = ReturnType<typeof buildPairingHistory>;

interface Matching {
  pairs: Array<[string, string]>;
  rematches: number;
}

/**
 * The pairing of `players` (in standings order) with the fewest rematches, preferring higher-ranked opponents: a depth-first
 * search that always pairs the highest-ranked unpaired player first and tries opponents in standings order, so the first
 * complete pairing it finds at a given rematch count is the one a top-down Monrad pairing would pick. `maxRematches` bounds
 * the search; `budget` caps its steps. Returns null when no pairing within the bound was found.
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
 * 5. When no bye and pairing avoid every rematch, the pairing with the fewest rematches (bounded search, then greedy)
 */
export function generateSwissRound(
  participantIds: string[],
  participantNames: Record<string, string>,
  matchHistory: MatchRecord[],
  roundNumber: number,
  byeHistory: ByeRecord[] = []
): GeneratedRound {
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

  const budget = { steps: SWISS_SEARCH_STEP_LIMIT };
  let chosen: { bye: string | null; matching: Matching } | null = null;
  // First: the best bye candidate that leaves a pairing without any rematch.
  for (const bye of byeCandidates) {
    const matching = searchPairing(without(bye), history, 0, budget);
    if (matching !== null) {
      chosen = { bye, matching };
      break;
    }
    if (budget.steps < 0) break;
  }
  // Else: the first candidate's pairing with the fewest rematches, or greedy when the search ran out of steps.
  if (chosen === null) {
    const bye = byeCandidates[0];
    const fallbackBudget = { steps: SWISS_SEARCH_STEP_LIMIT };
    const players = without(bye);
    const searched = searchPairing(players, history, players.length, fallbackBudget);
    const greedy = greedyPairing(players, history);
    if (budget.steps < 0 || fallbackBudget.steps < 0) {
      console.warn(`[swiss] round ${roundNumber}: the pairing search hit its step limit; using the best pairing found`);
    }
    chosen = { bye, matching: searched !== null && searched.rematches <= greedy.rematches ? searched : greedy };
  }

  return {
    round_number: roundNumber,
    round_name: `Round ${roundNumber}`,
    pairings: chosen.matching.pairs.map(([player_1_id, player_2_id]): Pairing => ({ player_1_id, player_2_id })),
    bye_player_ids: chosen.bye === null ? [] : [chosen.bye],
  };
}
