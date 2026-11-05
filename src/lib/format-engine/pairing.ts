/**
 * Pairing of the next round of a kit stage. Pure and client-safe; the generate-round route reads and writes.
 *
 * - Swiss: `rounds` caps the stage (`auto` is `ceil(log2 n)`, as the compiler's plan counts it). The players are
 *   ranked by the stage's own table (`computeStageStandings`), so score groups follow the stage's scoring and chain.
 *   With `avoid_repeats` off, earlier pairings do not steer the search (byes still rotate). The round reports how
 *   many pairings repeat an earlier one.
 * - Round robin: `legs` times the circle schedule. A later leg replays the first with sides swapped; with
 *   `mirror_legs` off, every second leg also runs the rounds in reverse order.
 * - Manual pairing and the elimination brackets are not paired here: an admin pairs a manual stage by hand, and
 *   the bracket engine builds an elimination stage whole.
 * - Filter: pairs the base (Swiss or round robin) and never pairs a pair the caller's `allowPair` rejects. Swiss searches
 *   for a pairing without rejected pairs and, when none exists, takes the one with the fewest (`forbidden` on the round);
 *   a round robin drops the rejected pairs from the circle schedule (they do not play) and counts them.
 * - Bipartite: players split by an attribute into side A and side B (`sides`); each round pairs A against B by standings,
 *   and the surplus of the larger side gets the bye. A player on neither side plays no round.
 * - Challenge: a ladder; no generator pairs it. Players challenge each other during the stage
 *   (`format_challenges`, `challenge.ts`), and an accepted challenge becomes a match.
 */
import type { GroupsSpec, Pairing, Stage } from '@/lib/format-kit/types';
import { ceilLog2 } from '@/lib/format-kit/engine/plan';
import { seededRand } from '@/lib/format-kit/expr/rand';
import { generateBipartiteRound } from '@/lib/tournament/bipartite';
import { generateRoundRobinRound, getRoundRobinTotalRounds } from '@/lib/tournament/round-robin';
import { generateSwissRound } from '@/lib/tournament/swiss';
import type { ByeRecord, GeneratedRound, MatchRecord } from '@/lib/tournament/types';
import { computeStageStandings, type KitOutcome } from './standings';

type RoundRobinPairing = Extract<Pairing, { kind: 'round_robin' }>;
type SwissPairing = Extract<Pairing, { kind: 'swiss' }>;

/** The round robin a pairing plays: itself, or the base of a filter over one. */
export function roundRobinOf(pairing: Pairing): RoundRobinPairing | null {
  if (pairing.kind === 'round_robin') return pairing;
  return pairing.kind === 'filter' && pairing.base.kind === 'round_robin' ? pairing.base : null;
}

/** The Swiss a pairing plays: itself, or the base of a filter over one. */
function swissOf(pairing: Pairing): SwissPairing | null {
  if (pairing.kind === 'swiss') return pairing;
  return pairing.kind === 'filter' && pairing.base.kind === 'swiss' ? pairing.base : null;
}

/** Rounds a stage plays with `n` players, or null when the stage is not paired round by round here. */
export function kitStageRounds(pairing: Pairing, n: number): number | null {
  if (pairing.kind === 'filter') return kitStageRounds(pairing.base, n);
  if (n < 2) return pairing.kind === 'challenge' ? null : 0;
  switch (pairing.kind) {
    case 'swiss':
      return pairing.rounds === 'auto' ? ceilLog2(n) : pairing.rounds;
    case 'round_robin':
      return pairing.legs * getRoundRobinTotalRounds(n);
    case 'bipartite':
      return pairing.rounds;
    default:
      return null;
  }
}

/** Round `roundNumber` (1-based) of a round robin played over `legs` legs. */
export function roundRobinLegRound(
  participantIds: string[],
  pairing: RoundRobinPairing,
  roundNumber: number,
): GeneratedRound {
  const base = getRoundRobinTotalRounds(participantIds.length);
  const total = pairing.legs * base;
  if (roundNumber < 1 || roundNumber > total) {
    throw new Error(`Invalid round number ${roundNumber}. This round robin has ${total} rounds.`);
  }
  const leg = Math.floor((roundNumber - 1) / base);
  const within = ((roundNumber - 1) % base) + 1;
  const second = leg % 2 === 1;
  const baseRound = second && !pairing.mirror_legs ? base - within + 1 : within;
  const generated = generateRoundRobinRound(participantIds, baseRound);
  return {
    round_number: roundNumber,
    round_name: `Round ${roundNumber}`,
    pairings: second
      ? generated.pairings.map((p) => ({ player_1_id: p.player_2_id, player_2_id: p.player_1_id }))
      : generated.pairings,
    bye_player_ids: generated.bye_player_ids,
  };
}

/**
 * The rounds of the leg `roundNumber` belongs to. A later leg repeats the pairings of the first on purpose, so a
 * check for repeated pairings looks only inside one leg.
 */
export function legRoundRange(n: number, roundNumber: number): { first: number; last: number } {
  const base = Math.max(1, getRoundRobinTotalRounds(n));
  const leg = Math.max(0, Math.floor((roundNumber - 1) / base));
  return { first: leg * base + 1, last: (leg + 1) * base };
}

/**
 * Round `roundNumber` of a round robin with a filter: the circle schedule without the pairs `allow` rejects. A rejected
 * pair does not play (neither player gets a bye for it); `forbidden` counts them.
 */
export function filteredRoundRobinRound(
  participantIds: string[],
  pairing: RoundRobinPairing,
  roundNumber: number,
  allow: (a: string, b: string) => boolean,
): GeneratedRound {
  const round = roundRobinLegRound(participantIds, pairing, roundNumber);
  const pairings = round.pairings.filter((p) => allow(p.player_1_id, p.player_2_id));
  return { ...round, pairings, forbidden: round.pairings.length - pairings.length };
}

/** A challenge ladder: its matches come from accepted challenges, not from a round generator. */
export function isChallengeLadder(pairing: Pairing): boolean {
  return pairing.kind === 'challenge';
}

/** Whether the kit pairs this stage round by round (Swiss, round robin, a filter over one, bipartite). */
export function kitPairsRounds(stage: Pick<Stage, 'pairing'>): boolean {
  const { kind } = stage.pairing;
  return kind === 'swiss' || kind === 'round_robin' || kind === 'filter' || kind === 'bipartite';
}

export interface KitPairingInput {
  stage: Pick<Stage, 'key' | 'pairing' | 'scoring' | 'rank'>;
  /** Players in seed order. */
  participantIds: string[];
  participantNames: Record<string, string>;
  /** Completed matches of the stage (or of the group). */
  matches: MatchRecord[];
  /** Every match already paired, whatever its status. */
  pairedMatches: MatchRecord[];
  byeHistory: ByeRecord[];
  roundNumber: number;
  outcomes?: Readonly<Record<string, KitOutcome>>;
  seed?: string | null;
  /**
   * Filter pairing: whether two players may be paired (the `allow` expression over the pair env). A filter stage without
   * it is a caller bug and throws, so a filter is never silently skipped.
   */
  allowPair?: (a: string, b: string) => boolean;
  /** Bipartite pairing: the side of each player. A bipartite stage without it throws; a player not listed plays no round. */
  sides?: Readonly<Record<string, 'a' | 'b'>>;
}

export type KitPairingResult =
  | { kind: 'round'; round: GeneratedRound }
  /** Every round of the stage is already written. */
  | { kind: 'complete'; rounds: number }
  /** The stage is paired by hand. */
  | { kind: 'manual' }
  /** The bracket engine builds this stage. */
  | { kind: 'bracket' }
  /** A challenge ladder: its matches come from accepted challenges. */
  | { kind: 'challenge' };

export function pairNextRound(input: KitPairingInput): KitPairingResult {
  const { stage, participantIds, roundNumber } = input;
  const pairing = stage.pairing;
  if (pairing.kind === 'manual') return { kind: 'manual' };
  if (pairing.kind === 'single_elim' || pairing.kind === 'double_elim') return { kind: 'bracket' };
  if (pairing.kind === 'challenge') return { kind: 'challenge' };
  const total = kitStageRounds(pairing, participantIds.length) ?? 0;
  if (roundNumber > total) return { kind: 'complete', rounds: total };

  const roundRobin = roundRobinOf(pairing);
  if (roundRobin !== null) {
    if (pairing.kind !== 'filter') return { kind: 'round', round: roundRobinLegRound(participantIds, roundRobin, roundNumber) };
    if (input.allowPair === undefined) throw new Error('pairNextRound: a filter stage needs allowPair');
    return { kind: 'round', round: filteredRoundRobinRound(participantIds, roundRobin, roundNumber, input.allowPair) };
  }

  const table = computeStageStandings({
    stage,
    participantIds,
    participantNames: input.participantNames,
    matches: input.matches,
    outcomes: input.outcomes,
    byes: input.byeHistory,
    seed: input.seed,
  });
  const ranked = table.map((row) => row.player_id);

  if (pairing.kind === 'bipartite') {
    if (input.sides === undefined) throw new Error('pairNextRound: a bipartite stage needs sides');
    const sides = input.sides;
    const round = generateBipartiteRound(
      participantIds.filter((id) => sides[id] === 'a'),
      participantIds.filter((id) => sides[id] === 'b'),
      input.matches,
      roundNumber,
      input.byeHistory,
      { ranked, pairedMatches: pairing.avoid_repeats ? input.pairedMatches : [] },
    );
    return { kind: 'round', round };
  }

  const swiss = swissOf(pairing);
  if (swiss === null) return { kind: 'complete', rounds: 0 };
  if (pairing.kind === 'filter' && input.allowPair === undefined) throw new Error('pairNextRound: a filter stage needs allowPair');
  const round = generateSwissRound(participantIds, input.participantNames, input.matches, roundNumber, input.byeHistory, {
    ranked,
    pairedMatches: swiss.avoid_repeats ? input.pairedMatches : [],
    ...(pairing.kind === 'filter' ? { allowPair: input.allowPair } : {}),
  });
  return { kind: 'round', round };
}

export interface FormedGroup {
  /** 1-based. */
  group_number: number;
  /** Players with their seed inside the group (1 = first). */
  members: { player_id: string; seed: number }[];
}

/**
 * Splits players (in seed order) into `spec.count` groups. Serpentine snakes the seeds (1..k, then k..1), straight
 * fills group 1 first, seeded random shuffles with the season seed and then deals like straight. Manual forms no
 * groups: an admin places the players. Empty groups are dropped.
 */
export function formKitGroups(
  playerIds: readonly string[],
  spec: GroupsSpec,
  options: { seed?: string | null; stageKey: string },
): FormedGroup[] {
  if (spec.method === 'manual' || spec.count < 1) return [];
  const count = Math.min(spec.count, playerIds.length);
  const groups: string[][] = Array.from({ length: count }, () => []);
  if (spec.method === 'straight' || spec.method === 'random_seeded') {
    const order =
      spec.method === 'straight'
        ? [...playerIds]
        : [...playerIds].sort((a, b) => {
            const seed = options.seed ?? '';
            const scope = `groups:${options.stageKey}`;
            return seededRand(seed, scope, a) - seededRand(seed, scope, b) || (a < b ? -1 : 1);
          });
    // Sizes differ by at most one: the first `n % count` groups take the extra player.
    let at = 0;
    for (let g = 0; g < count; g += 1) {
      const size = Math.floor(order.length / count) + (g < order.length % count ? 1 : 0);
      groups[g].push(...order.slice(at, at + size));
      at += size;
    }
  } else {
    playerIds.forEach((id, i) => {
      const lap = Math.floor(i / count);
      const at = i % count;
      groups[lap % 2 === 0 ? at : count - 1 - at].push(id);
    });
  }
  return groups
    .filter((members) => members.length > 0)
    .map((members, i) => ({ group_number: i + 1, members: members.map((player_id, j) => ({ player_id, seed: j + 1 })) }));
}
