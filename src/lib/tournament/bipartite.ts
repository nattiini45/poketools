import type { ByeRecord, GeneratedRound, MatchRecord, Pairing } from './types';
import { BYE_PLAYER_ID } from './types';
import { buildPairingHistory, havePlayed } from './standings';

/** Search steps each pairing search of a round may spend, as `SWISS_SEARCH_STEP_LIMIT` for Swiss. */
export const BIPARTITE_SEARCH_STEP_LIMIT = 200_000;

type PairingHistory = ReturnType<typeof buildPairingHistory>;

interface BipartiteMatching {
  pairs: Array<[string, string]>;
  rematches: number;
}

/**
 * Pairs `a[i]` with a player of `b` (both lists best first, equal length) with the fewest rematches. Each player of `a`
 * tries the players of `b` nearest in rank first, so the first rematch-free pairing found is the closest one to
 * "best against best". Null when no pairing within `maxRematches` was found or the budget ran out first.
 */
function searchBipartite(
  a: readonly string[],
  b: readonly string[],
  history: PairingHistory,
  maxRematches: number,
  budget: { steps: number },
): BipartiteMatching | null {
  const taken = new Set<number>();
  const pairs: Array<[string, string]> = [];
  let best: BipartiteMatching | null = null;
  const nearest = a.map((_, i) => b.map((_, j) => j).sort((x, y) => Math.abs(x - i) - Math.abs(y - i) || x - y));

  const visit = (at: number, rematches: number): boolean => {
    if (--budget.steps < 0) return true;
    if (at === a.length) {
      if (best === null || rematches < best.rematches) best = { pairs: [...pairs], rematches };
      return rematches === 0;
    }
    for (const j of nearest[at]) {
      if (taken.has(j)) continue;
      const total = rematches + (havePlayed(history, a[at], b[j]) ? 1 : 0);
      if (total > maxRematches || (best !== null && total >= best.rematches)) continue;
      taken.add(j);
      pairs.push([a[at], b[j]]);
      const stop = visit(at + 1, total);
      pairs.pop();
      taken.delete(j);
      if (stop) return true;
    }
    return false;
  };

  visit(0, 0);
  return best;
}

/** The sit-out sets to try, best first: the lowest-ranked players without a bye, then the lowest-ranked with one. */
function sitOutSets(surplus: readonly string[], count: number, history: PairingHistory): string[][] {
  if (count === 0) return [[]];
  const lowestFirst = [...surplus].reverse();
  const order = [
    ...lowestFirst.filter((id) => !havePlayed(history, id, BYE_PLAYER_ID)),
    ...lowestFirst.filter((id) => havePlayed(history, id, BYE_PLAYER_ID)),
  ];
  const sets: string[][] = [];
  for (let i = 0; i + count <= order.length; i += 1) sets.push(order.slice(i, i + count));
  return sets;
}

/**
 * Bipartite pairing: every round pairs a player of side A against a player of side B (the first one is `player_1_id`).
 * Both sides are ranked by `ranked` (best first) and paired nearest rank to nearest rank, never repeating a pairing
 * when any pairing of the round avoids it (the search backtracks). When one side is larger, its surplus players sit
 * out and get the bye: the lowest-ranked who have not had one (`byeHistory` lists the byes of earlier rounds) whose
 * absence still leaves a rematch-free pairing; with none, the fewest-rematches pairing of the first candidates.
 *
 * `pairedMatches` feeds only the no-rematch history (every match already paired, whatever its status); it defaults to
 * `matchHistory`. A player in neither side plays no round and is not given a bye. Pure.
 */
export function generateBipartiteRound(
  sideA: readonly string[],
  sideB: readonly string[],
  matchHistory: MatchRecord[],
  roundNumber: number,
  byeHistory: ByeRecord[] = [],
  options: {
    /** All players, best first; a player missing from it ranks below those listed, in the order given. */
    ranked: readonly string[];
    pairedMatches?: MatchRecord[];
    stepLimit?: number;
  },
): GeneratedRound {
  const history = buildPairingHistory(options.pairedMatches ?? matchHistory, byeHistory);
  const position = new Map(options.ranked.map((id, i) => [id, i]));
  const byRank = (ids: readonly string[]): string[] =>
    ids
      .map((id, i) => ({ id, at: position.get(id) ?? options.ranked.length + i }))
      .sort((x, y) => x.at - y.at)
      .map((entry) => entry.id);
  const a = byRank(sideA);
  const b = byRank(sideB);
  const smaller = a.length <= b.length ? a : b;
  const larger = smaller === a ? b : a;
  // With an empty side nobody can be paired, so nobody sits out for a bye either.
  const surplus = smaller.length === 0 ? 0 : larger.length - smaller.length;
  const sets = smaller.length === 0 ? [[]] : sitOutSets(larger, surplus, history);
  const playing = (sitting: readonly string[]) => larger.filter((id) => !sitting.includes(id));
  // The search pairs a player of the smaller side first; side A is always `player_1_id`.
  const orient = (matching: BipartiteMatching): Array<[string, string]> =>
    matching.pairs.map(([x, y]) => (a === smaller ? [x, y] : [y, x]));

  const budget = { steps: options.stepLimit ?? BIPARTITE_SEARCH_STEP_LIMIT };
  let chosen: { sitting: string[]; matching: BipartiteMatching } | null = null;
  for (const sitting of sets) {
    const matching = searchBipartite(smaller, playing(sitting), history, 0, budget);
    if (matching !== null) {
      chosen = { sitting, matching };
      break;
    }
    if (budget.steps < 0) break;
  }
  if (chosen === null) {
    const sitting = sets[0] ?? [];
    const matching = searchBipartite(smaller, playing(sitting), history, smaller.length, { steps: options.stepLimit ?? BIPARTITE_SEARCH_STEP_LIMIT });
    chosen = { sitting, matching: matching ?? greedyBipartite(smaller, playing(sitting), history) };
  }

  return {
    round_number: roundNumber,
    round_name: `Round ${roundNumber}`,
    pairings: orient(chosen.matching).map(([player_1_id, player_2_id]): Pairing => ({ player_1_id, player_2_id })),
    bye_player_ids: chosen.sitting,
    rematches: chosen.matching.rematches,
  };
}

/** Rank against rank, rematches or not: the answer when the bounded search found nothing. */
function greedyBipartite(a: readonly string[], b: readonly string[], history: PairingHistory): BipartiteMatching {
  const pairs: Array<[string, string]> = a.map((id, i) => [id, b[i]]);
  return { pairs, rematches: pairs.filter(([x, y]) => havePlayed(history, x, y)).length };
}
