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

/** One round of a pre-generated bipartite schedule: side A is always the first of a pair. */
export interface BipartiteScheduleRound {
  pairs: Array<[string, string]>;
  /** Players of the larger side without an opponent this round. */
  sitting: string[];
}

/**
 * The full A x B schedule (a cyclic Latin rectangle): `max(|A|, |B|)` rounds in which every player of the smaller
 * side plays every round and every pair (a, b) meets exactly once. In round `r` the `i`-th player of the smaller side
 * meets the `(i + r) mod m`-th of the larger side (`m` = its size); the larger side's players not reached sit out.
 * The sides are taken in the order given (callers pass seed order), never re-ranked, so the schedule is the same in
 * every round of a stage and its guarantee ("every A meets every B") cannot be broken by moving standings. Pure and
 * deterministic: no randomness. Duplicates in a side are dropped (first kept); an empty side yields no rounds.
 */
export function buildBipartiteSchedule(sideA: readonly string[], sideB: readonly string[]): BipartiteScheduleRound[] {
  const a = [...new Set(sideA)];
  const b = [...new Set(sideB)];
  if (a.length === 0 || b.length === 0) return [];
  const aSmaller = a.length <= b.length;
  const small = aSmaller ? a : b;
  const large = aSmaller ? b : a;
  const m = large.length;
  return Array.from({ length: m }, (_, r): BipartiteScheduleRound => ({
    pairs: small.map((s, i): [string, string] => {
      const l = large[(i + r) % m];
      return aSmaller ? [s, l] : [l, s];
    }),
    // Large index j plays in round r when (j - r) mod m is below |small|.
    sitting: large.filter((_, j) => (((j - r) % m) + m) % m >= small.length),
  }));
}

/**
 * Bipartite pairing: every round pairs a player of side A against a player of side B (the first one is `player_1_id`).
 *
 * The rounds come from the pre-generated schedule of `buildBipartiteSchedule` (built from the sides in the order given,
 * so every A meets every B exactly once over `max(|A|, |B|)` rounds whatever the standings do). Round `roundNumber` is
 * schedule round `(roundNumber - 1) mod m`; if one of its pairs was already paired (a skipped, re-run or hand-made
 * round) the next schedule round without a rematch is used instead. The surplus players of the larger side sit out
 * (the bye) as the schedule says. Past the last schedule round, or when no schedule round is rematch-free, every
 * meeting has happened: the standings-based search takes over and pairs nearest rank to nearest rank with the fewest
 * rematches (an explicit extra meeting, reported in `rematches`).
 *
 * `pairedMatches` feeds only the no-rematch history (every match already paired, whatever its status); it defaults to
 * `matchHistory`. With an empty history the schedule is simply cycled. `ranked` orders the fallback only; `byeHistory`
 * lists the byes of earlier rounds and steers the fallback's choice of who sits out. A player in neither side plays no
 * round and is not given a bye. Pure and deterministic.
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

  if (smaller.length > 0) {
    const scheduled = pickScheduledRound(sideA, sideB, history, roundNumber);
    if (scheduled !== null) {
      return {
        round_number: roundNumber,
        round_name: `Round ${roundNumber}`,
        pairings: scheduled.pairs.map(([player_1_id, player_2_id]): Pairing => ({ player_1_id, player_2_id })),
        bye_player_ids: scheduled.sitting,
        rematches: 0,
      };
    }
  }

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

/**
 * The schedule round to play as round `roundNumber`: the nominal one, else the next without a rematch against the
 * history. Null when there is none (every meeting is done, or an earlier hand-made round broke every schedule round).
 */
function pickScheduledRound(
  sideA: readonly string[],
  sideB: readonly string[],
  history: PairingHistory,
  roundNumber: number,
): BipartiteScheduleRound | null {
  const schedule = buildBipartiteSchedule(sideA, sideB);
  const m = schedule.length;
  if (m === 0) return null;
  const start = (((roundNumber - 1) % m) + m) % m;
  for (let k = 0; k < m; k += 1) {
    const round = schedule[(start + k) % m];
    if (!round.pairs.some(([x, y]) => havePlayed(history, x, y))) return round;
  }
  return null;
}

/** Rank against rank, rematches or not: the answer when the bounded search found nothing. */
function greedyBipartite(a: readonly string[], b: readonly string[], history: PairingHistory): BipartiteMatching {
  const pairs: Array<[string, string]> = a.map((id, i) => [id, b[i]]);
  return { pairs, rematches: pairs.filter(([x, y]) => havePlayed(history, x, y)).length };
}
