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
 */
import type { GroupsSpec, Pairing, Stage } from '@/lib/format-kit/types';
import { ceilLog2 } from '@/lib/format-kit/engine/plan';
import { seededRand } from '@/lib/format-kit/expr/rand';
import { generateRoundRobinRound, getRoundRobinTotalRounds } from '@/lib/tournament/round-robin';
import { generateSwissRound } from '@/lib/tournament/swiss';
import type { ByeRecord, GeneratedRound, MatchRecord } from '@/lib/tournament/types';
import { computeStageStandings, type KitOutcome } from './standings';

/** Rounds a stage plays with `n` players, or null when the stage is not paired round by round here. */
export function kitStageRounds(pairing: Pairing, n: number): number | null {
  if (n < 2) return 0;
  switch (pairing.kind) {
    case 'swiss':
      return pairing.rounds === 'auto' ? ceilLog2(n) : pairing.rounds;
    case 'round_robin':
      return pairing.legs * getRoundRobinTotalRounds(n);
    default:
      return null;
  }
}

/** Round `roundNumber` (1-based) of a round robin played over `legs` legs. */
export function roundRobinLegRound(
  participantIds: string[],
  pairing: Extract<Pairing, { kind: 'round_robin' }>,
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

/** Whether the kit pairs this stage round by round (Swiss or round robin). */
export function kitPairsRounds(stage: Pick<Stage, 'pairing'>): boolean {
  return stage.pairing.kind === 'swiss' || stage.pairing.kind === 'round_robin';
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
}

export type KitPairingResult =
  | { kind: 'round'; round: GeneratedRound }
  /** Every round of the stage is already written. */
  | { kind: 'complete'; rounds: number }
  /** The stage is paired by hand. */
  | { kind: 'manual' }
  /** The bracket engine builds this stage. */
  | { kind: 'bracket' };

export function pairNextRound(input: KitPairingInput): KitPairingResult {
  const { stage, participantIds, roundNumber } = input;
  const pairing = stage.pairing;
  if (pairing.kind === 'manual') return { kind: 'manual' };
  if (pairing.kind === 'single_elim' || pairing.kind === 'double_elim') return { kind: 'bracket' };
  const total = kitStageRounds(pairing, participantIds.length) ?? 0;
  if (roundNumber > total) return { kind: 'complete', rounds: total };

  if (pairing.kind === 'round_robin') {
    return { kind: 'round', round: roundRobinLegRound(participantIds, pairing, roundNumber) };
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
  const round = generateSwissRound(participantIds, input.participantNames, input.matches, roundNumber, input.byeHistory, {
    ranked: table.map((row) => row.player_id),
    pairedMatches: pairing.avoid_repeats ? input.pairedMatches : [],
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
