/**
 * The schedule estimator: how many rounds, matches, byes and weeks a compiled format plays for a given number of
 * players. A pure function of the compile result (definition, plan, graph) and two numbers; the Studio's Schedule
 * tab shows it before any league exists.
 *
 * Conventions (documented in docs/format-kit.md):
 * - A best-of series counts as ONE match.
 * - Stages run one after the other, so the totals are an upper bound for stages that could overlap.
 * - Elimination stages report bounds: the matches a player plays depend on how far they get.
 * - A stage with manual pairing, or without a participant count, is `unknown`: every number is `null`.
 * - The weeks of a stage are `ceil(rounds * roundDays / 7)`. The totals add the rounds first and round once, so
 *   stage rounding does not pile up.
 *
 * Pure: no clock, no randomness, no I/O.
 */
import { getRoundRobinTotalRounds } from '@/lib/tournament/round-robin';
import type { FormatDefinition, Stage } from '../types';
import type { CompileResult } from './core';
import { ceilLog2, mapRange, nextPowerOfTwo, type CountRange, type StagePlan } from './plan';

export const SCHEDULE_DEFAULT_PLAYERS = 8;
export const SCHEDULE_MIN_PLAYERS = 2;
/** The UI cap; the compiler accepts up to 4096 players. */
export const SCHEDULE_MAX_PLAYERS = 256;
/** Days per round the Schedule tab offers. */
export const SCHEDULE_CADENCES = [1, 2, 3, 7, 10, 14] as const;
export const SCHEDULE_DEFAULT_ROUND_DAYS = 7;
export type ScheduleCadence = (typeof SCHEDULE_CADENCES)[number];

/** The largest roster the estimator accepts (the compiler's own bound). */
const ESTIMATE_MAX_PLAYERS = 4096;
const MAX_ROUND_DAYS = 28;

export type SchedulePrecision = 'exact' | 'bounds' | 'unknown';

export interface StageSchedule {
  key: string;
  participants: CountRange | null;
  /** `stage.groups.count`. */
  groups: number | null;
  rounds: CountRange | null;
  /** A best-of series counts as one match. */
  matches: CountRange | null;
  matchesPerPlayer: CountRange | null;
  /** Total byes over the stage. */
  byes: CountRange | null;
  bracketSize: number | null;
  /** `ceil(rounds * roundDays / 7)`. */
  weeks: CountRange | null;
  /** `bounds` for elimination (per-player matches, bracket reset) and for an uncertain participant count. */
  precision: SchedulePrecision;
}

export interface ScheduleEstimate {
  players: number;
  roundDays: number;
  /** Graph order, then any stage missing from the graph. */
  stages: StageSchedule[];
  /** Stages run one after the other. A stage with unknown numbers makes the matching total `null`. */
  totals: { rounds: CountRange | null; matches: CountRange | null; weeks: CountRange | null };
}

/** The numbers of one stage for one exact participant count. */
interface Figures {
  rounds: number;
  matchesMin: number;
  matchesMax: number;
  perPlayerMin: number;
  perPlayerMax: number;
  byes: number;
}

const ZERO: Figures = { rounds: 0, matchesMin: 0, matchesMax: 0, perPlayerMin: 0, perPlayerMax: 0, byes: 0 };

function roundRobinFigures(stage: Stage, legs: number, n: number): Figures {
  const groups = stage.groups?.count ?? 1;
  const base = Math.floor(n / groups);
  const larger = n % groups;
  // `larger` groups of `base + 1` players, the others of `base`.
  const sizes: Array<{ size: number; count: number }> = [
    { size: base + 1, count: larger },
    { size: base, count: groups - larger },
  ];
  let matches = 0;
  let byes = 0;
  let rounds = 0;
  let smallest = Number.POSITIVE_INFINITY;
  let largest = 0;
  for (const { size, count } of sizes) {
    if (count === 0) continue;
    smallest = Math.min(smallest, size);
    largest = Math.max(largest, size);
    if (size < 2) continue;
    matches += count * legs * ((size * (size - 1)) / 2);
    if (size % 2 === 1) byes += count * legs * size;
    rounds = Math.max(rounds, legs * getRoundRobinTotalRounds(size));
  }
  return {
    rounds,
    matchesMin: matches,
    matchesMax: matches,
    perPlayerMin: legs * Math.max(0, smallest - 1),
    perPlayerMax: legs * Math.max(0, largest - 1),
    byes,
  };
}

function swissFigures(rounds: number | 'auto', n: number): Figures {
  const played = rounds === 'auto' ? (n < 2 ? 0 : ceilLog2(n)) : n < 2 ? 0 : rounds;
  const matches = played * Math.floor(n / 2);
  const odd = n % 2 === 1;
  return {
    rounds: played,
    matchesMin: matches,
    matchesMax: matches,
    perPlayerMin: odd ? Math.max(0, played - 1) : played,
    perPlayerMax: played,
    byes: odd ? played : 0,
  };
}

function singleElimFigures(thirdPlace: boolean, n: number): Figures {
  const rounds = ceilLog2(n);
  const matches = n - 1 + (thirdPlace ? 1 : 0);
  return {
    rounds,
    matchesMin: matches,
    matchesMax: matches,
    perPlayerMin: 1,
    perPlayerMax: rounds,
    byes: nextPowerOfTwo(n) - n,
  };
}

function doubleElimFigures(bracketReset: boolean, n: number): Figures {
  const rounds = 2 * ceilLog2(n) - 1 + (bracketReset ? 1 : 0);
  return {
    rounds,
    matchesMin: 2 * n - 2,
    matchesMax: 2 * n - 2 + (bracketReset ? 1 : 0),
    perPlayerMin: 2,
    perPlayerMax: Math.max(2, rounds),
    byes: nextPowerOfTwo(n) - n,
  };
}

function figuresFor(stage: Stage, n: number): Figures {
  if (n < 2) return ZERO;
  const pairing = stage.pairing;
  switch (pairing.kind) {
    case 'round_robin':
      return roundRobinFigures(stage, pairing.legs, n);
    case 'swiss':
      return swissFigures(pairing.rounds, n);
    case 'single_elim':
      return singleElimFigures(pairing.third_place, n);
    case 'double_elim':
      return doubleElimFigures(pairing.bracket_reset, n);
    default:
      return ZERO;
  }
}

/** The smallest and largest value `pick` takes over the integers of a range. */
function spread(range: CountRange, lo: (n: number) => number, hi: (n: number) => number): CountRange {
  return { min: mapRange(range, lo).min, max: mapRange(range, hi).max };
}

function weeksOf(rounds: CountRange, roundDays: number): CountRange {
  return { min: Math.ceil((rounds.min * roundDays) / 7), max: Math.ceil((rounds.max * roundDays) / 7) };
}

function unknownStage(stage: Stage, plan: StagePlan | undefined): StageSchedule {
  return {
    key: stage.key,
    participants: plan?.participants ?? null,
    groups: stage.groups?.count ?? null,
    rounds: null,
    matches: null,
    matchesPerPlayer: null,
    byes: null,
    bracketSize: plan?.bracketSize ?? null,
    weeks: null,
    precision: 'unknown',
  };
}

function stageSchedule(stage: Stage, plan: StagePlan | undefined, roundDays: number): StageSchedule {
  const participants = plan?.participants ?? null;
  if (participants === null || stage.pairing.kind === 'manual') return unknownStage(stage, plan);
  const rounds = spread(participants, (n) => figuresFor(stage, n).rounds, (n) => figuresFor(stage, n).rounds);
  const elimination = stage.pairing.kind === 'single_elim' || stage.pairing.kind === 'double_elim';
  const uncertain = elimination || participants.min !== participants.max;
  return {
    key: stage.key,
    participants,
    groups: stage.groups?.count ?? null,
    rounds,
    matches: spread(participants, (n) => figuresFor(stage, n).matchesMin, (n) => figuresFor(stage, n).matchesMax),
    matchesPerPlayer: spread(participants, (n) => figuresFor(stage, n).perPlayerMin, (n) => figuresFor(stage, n).perPlayerMax),
    byes: spread(participants, (n) => figuresFor(stage, n).byes, (n) => figuresFor(stage, n).byes),
    bracketSize: plan?.bracketSize ?? null,
    weeks: weeksOf(rounds, roundDays),
    precision: uncertain ? 'bounds' : 'exact',
  };
}

function clampPlayers(players: number): number {
  if (!Number.isFinite(players)) return SCHEDULE_MIN_PLAYERS;
  return Math.min(ESTIMATE_MAX_PLAYERS, Math.max(SCHEDULE_MIN_PLAYERS, Math.trunc(players)));
}

function normalizeRoundDays(roundDays: number | undefined): number {
  if (roundDays === undefined || !Number.isInteger(roundDays) || roundDays < 1 || roundDays > MAX_ROUND_DAYS) {
    return SCHEDULE_DEFAULT_ROUND_DAYS;
  }
  return roundDays;
}

/** Stages in graph order; a stage missing from the graph follows in declaration order. */
function orderedStages(definition: FormatDefinition, order: readonly string[]): Stage[] {
  const byKey = new Map<string, Stage>();
  for (const stage of definition.stages) {
    if (!byKey.has(stage.key)) byKey.set(stage.key, stage);
  }
  const out: Stage[] = [];
  const seen = new Set<string>();
  for (const key of order) {
    const stage = byKey.get(key);
    if (stage !== undefined && !seen.has(key)) {
      out.push(stage);
      seen.add(key);
    }
  }
  for (const stage of definition.stages) {
    if (!seen.has(stage.key)) {
      out.push(stage);
      seen.add(stage.key);
    }
  }
  return out;
}

function sumRanges(ranges: ReadonlyArray<CountRange | null>): CountRange | null {
  if (ranges.length === 0) return null;
  let total: CountRange = { min: 0, max: 0 };
  for (const range of ranges) {
    if (range === null) return null;
    total = { min: total.min + range.min, max: total.max + range.max };
  }
  return total;
}

/**
 * The schedule of a compiled definition for `opts.players` players. Compile the definition with
 * `rosterSize = players` first, so the roster stages start from that count. `null` when the document did not
 * compile far enough to have a definition and a plan.
 */
export function estimateSchedule(
  result: Pick<CompileResult, 'definition' | 'plan' | 'graph'>,
  opts: { players: number; roundDays?: number },
): ScheduleEstimate | null {
  const { definition, plan } = result;
  if (definition === null || plan === null) return null;
  const players = clampPlayers(opts.players);
  const roundDays = normalizeRoundDays(opts.roundDays);
  const planByKey = new Map<string, StagePlan>();
  for (const entry of plan) {
    if (!planByKey.has(entry.key)) planByKey.set(entry.key, entry);
  }
  const stages = orderedStages(definition, result.graph?.order ?? []).map((stage) =>
    stageSchedule(stage, planByKey.get(stage.key), roundDays),
  );
  const rounds = sumRanges(stages.map((s) => s.rounds));
  return {
    players,
    roundDays,
    stages,
    totals: {
      rounds,
      matches: sumRanges(stages.map((s) => s.matches)),
      weeks: rounds === null ? null : weeksOf(rounds, roundDays),
    },
  };
}

/**
 * The smallest roster that lets every roster-fed stage start: a stage with groups needs two players per group,
 * any other stage two. 2 when no stage is fed by the roster.
 */
export function minRosterFor(def: FormatDefinition): number {
  let need = SCHEDULE_MIN_PLAYERS;
  for (const stage of def.stages) {
    if (stage.participants.from !== 'roster') continue;
    need = Math.max(need, stage.groups ? stage.groups.count * 2 : SCHEDULE_MIN_PLAYERS);
  }
  return need;
}
