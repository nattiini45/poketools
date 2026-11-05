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
  /** Pairs the caller's `allowPair` rejects (0 without a filter). */
  forbidden: number;
}

type AllowPair = (a: string, b: string) => boolean;

/**
 * What a matching costs: a forbidden pair outweighs any number of rematches (a round holds fewer than `size` of them), so
 * the search first minimises the forbidden pairs and then the rematches.
 */
function costOf(matching: Pick<Matching, 'rematches' | 'forbidden'>, size: number): number {
  return matching.forbidden * (size + 1) + matching.rematches;
}

/**
 * The pairing of `players` (in standings order) with the fewest rematches, preferring higher-ranked opponents: a depth-first
 * search that always pairs the highest-ranked unpaired player first and tries opponents in standings order. With
 * `maxRematches` = 0 it returns the first rematch-free pairing in that order: the top-down Monrad pairing whenever that
 * pairing has no rematch, else the nearest rematch-free one to it. `maxRematches` bounds the search; `budget` caps its steps. Returns null when no pairing within
 * the bound was found, or when the budget ran out before one was. `allow` marks the pairs that may be paired: a rejected
 * pair costs more than any rematch (`costOf`), and `maxRematches` and `maxForbidden` bound each count on its own.
 */
function searchPairing(
  players: readonly string[],
  history: PairingHistory,
  maxRematches: number,
  budget: { steps: number },
  allow?: AllowPair,
  maxForbidden = 0,
): Matching | null {
  const paired = new Set<string>();
  const pairs: Array<[string, string]> = [];
  let best: Matching | null = null;
  const weight = players.length + 1;

  const visit = (cost: number, rematches: number, forbidden: number): boolean => {
    if (--budget.steps < 0) return true;
    const first = players.find((player) => !paired.has(player));
    if (first === undefined) {
      if (best === null || cost < costOf(best, players.length)) best = { pairs: [...pairs], rematches, forbidden };
      // A pairing without rematches or forbidden pairs cannot be beaten: stop.
      return cost === 0;
    }
    paired.add(first);
    for (const opponent of players) {
      if (paired.has(opponent)) continue;
      const rematch = havePlayed(history, first, opponent) ? 1 : 0;
      const forbids = allow !== undefined && !allow(first, opponent) ? 1 : 0;
      const total = cost + rematch + forbids * weight;
      if (
        rematches + rematch > maxRematches ||
        forbidden + forbids > maxForbidden ||
        (best !== null && total >= costOf(best, players.length))
      ) {
        continue;
      }
      paired.add(opponent);
      pairs.push([first, opponent]);
      const stop = visit(total, rematches + rematch, forbidden + forbids);
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

  visit(0, 0, 0);
  return best;
}

/** The old top-down pairing: next unpaired opponent who has not met the player, else simply the next one. */
function greedyPairing(players: readonly string[], history: PairingHistory, allow?: AllowPair): Matching {
  const paired = new Set<string>();
  const pairs: Array<[string, string]> = [];
  let rematches = 0;
  let forbidden = 0;
  const open = (p1: string, from: number) => players.slice(from).filter((candidate) => !paired.has(candidate) && candidate !== p1);
  for (let i = 0; i < players.length; i++) {
    const p1 = players[i];
    if (paired.has(p1)) continue;
    const rest = open(p1, i + 1);
    const allowed = rest.filter((candidate) => allow === undefined || allow(p1, candidate));
    // An allowed opponent first (without a rematch when there is one), a forbidden one only when none is left.
    let p2 = allowed.find((candidate) => !havePlayed(history, p1, candidate));
    if (p2 === undefined) p2 = allowed[0];
    if (p2 === undefined) {
      p2 = rest[0];
      if (p2 === undefined) break;
      forbidden += 1;
    }
    if (havePlayed(history, p1, p2)) rematches += 1;
    paired.add(p1);
    paired.add(p2);
    pairs.push([p1, p2]);
  }
  return { pairs, rematches, forbidden };
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
  options: {
    /** Overrides `SWISS_SEARCH_STEP_LIMIT` (tests). */
    stepLimit?: number;
    /**
     * Every match already paired, whatever its status (`getPairedMatchRecords`). It feeds only the no-rematch
     * history: a scheduled or disputed match is still "these two have met", but it has no result and scores nothing.
     * Defaults to `matchHistory`.
     */
    pairedMatches?: MatchRecord[];
    /**
     * The players in standings order, best first, when the caller ranks them itself (the format kit ranks by the
     * stage's own scoring and chain). Defaults to the generic table of `matchHistory` and `byeHistory`.
     */
    ranked?: readonly string[];
    /**
     * A hard filter: the pairs it rejects are never paired while any other pairing of the round exists. When none does,
     * the round is the one with the fewest rejected pairs (then the fewest rematches) and `forbidden` reports how many.
     */
    allowPair?: (a: string, b: string) => boolean;
  } = {},
): GeneratedRound {
  const stepLimit = options.stepLimit ?? SWISS_SEARCH_STEP_LIMIT;
  const history = buildPairingHistory(options.pairedMatches ?? matchHistory, byeHistory);
  const ranked =
    options.ranked !== undefined
      ? [...options.ranked]
      : computeStandings(participantIds, participantNames, matchHistory, {}, { byes: byeHistory }).map((s) => s.player_id);

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
    const matching = searchPairing(without(bye), history, 0, budget, options.allowPair);
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
    const searched = searchPairing(players, history, players.length, fallbackBudget, options.allowPair, players.length);
    const greedy = greedyPairing(players, history, options.allowPair);
    const matching = searched !== null && costOf(searched, players.length) <= costOf(greedy, players.length) ? searched : greedy;
    // Only a result the search could not prove minimal is worth a line: a completed search's fallback is the best there is.
    if (fallbackBudget.steps < 0) {
      console.warn(
        `[swiss] round ${roundNumber} of ${ranked.length} players: the fewest-rematches search hit its step limit; ` +
          `${matching === greedy ? 'used the greedy pairing' : 'used the best pairing found'} (${matching.rematches} rematches, ${matching.forbidden} forbidden)`,
      );
    }
    chosen = { bye, matching };
  }

  return {
    round_number: roundNumber,
    round_name: `Round ${roundNumber}`,
    pairings: chosen.matching.pairs.map(([player_1_id, player_2_id]): Pairing => ({ player_1_id, player_2_id })),
    bye_player_ids: chosen.bye === null ? [] : [chosen.bye],
    rematches: chosen.matching.rematches,
    ...(options.allowPair !== undefined ? { forbidden: chosen.matching.forbidden } : {}),
  };
}
