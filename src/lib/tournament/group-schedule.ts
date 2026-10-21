import { generateRoundRobinRound, getRoundRobinTotalRounds } from './round-robin';
import type { Pairing } from './types';

/**
 * The week plan of a grouped round robin phase (league groups design, lead rulings round 3). Pure and
 * deterministic: no randomness, no clock, no reads. The same inputs always give the same plan, so a plan can
 * be recomputed at any later generation and audited.
 *
 * Weeks are shared phase-wide (`rounds.round_number` = week). Every group plays its own single round robin
 * (circle method, `generateRoundRobinRound`) inside those weeks, with its own round count; a group with fewer
 * in-group rounds rests in the remaining in-group weeks (nothing throws, nothing is half-written).
 *
 * Without cross-group play (a single group, or phase groups that do not mirror league groups) the plan is the
 * old schedule: weeks 1..R, R = the largest group's round count, each group's round `w` in week `w`.
 *
 * With cross-group play (a phase whose groups mirror two or more league groups) the weeks fall into two halves,
 * and in each half every trainer gets the same number of cross-group matches where possible
 * (`CROSS_MATCHES_PER_HALF`, the history's 2 per half):
 *   1. in every in-group week, the trainers without an in-group match (the bye of an odd group, every member of
 *      a resting group) meet across groups, paired by seed, preferring opponents not met yet;
 *   2. trainers still below the target before the last week of the half (even groups have no byes) get
 *      dedicated cross weeks, paired across groups by mirrored seeds (seed 1 against the other group's last);
 *   3. the LAST week of each half is the placement week: every trainer meets the same-placed trainer of another
 *      group, by the group tables after the previous week. Its pairings need those tables, so the plan leaves
 *      them open (`awaitingTables`) until the caller generates that week (`pairPlacementWeek`).
 * The in-group rounds are split between the halves so that the first half is exactly the first
 * `floor(totalWeeks / 2)` weeks: the Hinrunde stays "the first half of the phase's weeks"
 * (`hinrundeLastRound` in src/lib/season/epb-phase.ts).
 */

/** Cross-group matches per trainer per half: one regular (rule 1 or 2) and the placement week (rule 3). */
export const CROSS_MATCHES_PER_HALF = 2;
const REGULAR_CROSS_PER_HALF = CROSS_MATCHES_PER_HALF - 1;
/** Dedicated cross weeks a half may add before it stops trying (a trainer no partner can reach stays short). */
const MAX_CROSS_WEEKS_PER_HALF = REGULAR_CROSS_PER_HALF + 1;

/** One group of the phase: its id and its members in seed order (seed 1 first). */
export interface ScheduleGroup {
  id: string;
  memberIds: readonly string[];
}

export type PlannedWeekKind = 'group' | 'cross' | 'placement';

export interface PlannedWeek {
  /** The phase week (`rounds.round_number`), 1-based. */
  week: number;
  /** 1 = Hinrunde, 2 = Rückrunde. */
  half: 1 | 2;
  /** `group`: in-group round robin week; `cross`: dedicated cross week; `placement`: same-placed trainers meet. */
  kind: PlannedWeekKind;
  /** Per group id: the in-group round it plays this week, or null when it plays none (rest, cross, placement). */
  groupRounds: Readonly<Record<string, number | null>>;
  /** The week's in-group pairings. */
  groupPairings: Pairing[];
  /** The week's cross-group pairings (a placement week's only once its pairings were given). */
  crossPairings: Pairing[];
  /** A placement week whose pairings wait for the group tables after the previous week. */
  awaitingTables: boolean;
}

export interface GroupSchedulePlan {
  /** Whether the plan schedules cross-group matches (two or more mirrored groups). */
  crossGroup: boolean;
  totalWeeks: number;
  /** The last Hinrunde week: `floor(totalWeeks / 2)`, the same boundary as `hinrundeLastRound`. */
  firstHalfLastWeek: number;
  weeks: PlannedWeek[];
}

export interface GroupScheduleOptions {
  /** Schedule cross-group matches (the phase's groups mirror league groups). Ignored with fewer than two groups. */
  crossGroup: boolean;
  /**
   * Pairings of placement weeks already generated, by week. Later weeks then prefer opponents not met there
   * either; weeks before them never change.
   */
  placementPairings?: ReadonlyMap<number, readonly Pairing[]>;
}

/**
 * `no_balance`: no split of the in-group rounds makes the first half exactly the first `floor(weeks / 2)` weeks.
 * Unreachable for every layout probed (2..10 groups of 2..10 trainers); kept as a coded refusal so a future planner
 * change fails cleanly instead of as a generic 500.
 */
export type GroupScheduleErrorCode = 'no_groups' | 'group_empty' | 'player_in_several_groups' | 'no_balance';

/** A group layout no schedule can be planned for (the caller maps it to a user-facing refusal). */
export class GroupScheduleError extends Error {
  readonly code: GroupScheduleErrorCode;
  constructor(code: GroupScheduleErrorCode, message: string) {
    super(message);
    this.name = 'GroupScheduleError';
    this.code = code;
  }
}

/** The Hinrunde boundary of a phase with `totalWeeks` weeks; mirrors `hinrundeLastRound` (epb-phase.ts). */
export function firstHalfLastWeek(totalWeeks: number): number {
  return Math.floor(totalWeeks / 2);
}

/** Every pairing of a planned week (in-group first, then cross-group). */
export function weekPairings(week: PlannedWeek): Pairing[] {
  return [...week.groupPairings, ...week.crossPairings];
}

/** The order-free key of a pairing (who met whom). */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

function validateGroups(groups: readonly ScheduleGroup[]): void {
  if (groups.length === 0) throw new GroupScheduleError('no_groups', 'A grouped schedule needs at least one group');
  const seen = new Set<string>();
  for (const group of groups) {
    if (group.memberIds.length === 0) {
      throw new GroupScheduleError('group_empty', `Group ${group.id} has no members`);
    }
    for (const id of group.memberIds) {
      if (seen.has(id)) {
        throw new GroupScheduleError('player_in_several_groups', `Player ${id} is in more than one group`);
      }
      seen.add(id);
    }
  }
}

interface Seat {
  id: string;
  group: number;
  /** 0-based seed position inside the group. */
  seed: number;
}

/**
 * Pair `seats` across groups: as many pairs as the group sizes allow (largest remaining group first, ties to
 * the earlier group, which reaches the maximum `min(floor(n/2), n - largest group)`), each seat of the chosen
 * group taken in turn and matched with an opponent of the next largest group that it has not met yet, else
 * any. Inside a group the seats are taken by `priority` (fewest cross-group matches in the phase so far), then
 * by seed, so a trainer left out once is served first next time. `order` picks the opponent among equals:
 * `seed` the best seed, `mirrored` the last seed. Unpaired seats stay out. Deterministic.
 */
function crossPair(
  seats: readonly Seat[],
  met: ReadonlySet<string>,
  order: 'seed' | 'mirrored',
  priority: ReadonlyMap<string, number>,
): Pairing[] {
  const rank = (seat: Seat) => priority.get(seat.id) ?? 0;
  const buckets = new Map<number, Seat[]>();
  for (const seat of [...seats].sort((a, b) => a.group - b.group || rank(a) - rank(b) || a.seed - b.seed)) {
    const bucket = buckets.get(seat.group);
    if (bucket) bucket.push(seat);
    else buckets.set(seat.group, [seat]);
  }
  const pairs: Pairing[] = [];
  const largest = (exclude: number | null): Seat[] | null => {
    let best: Seat[] | null = null;
    for (const [group, bucket] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
      if (group === exclude || bucket.length === 0) continue;
      if (!best || bucket.length > best.length) best = bucket;
    }
    return best;
  };
  for (;;) {
    const from = largest(null);
    if (!from) break;
    const to = largest(from[0].group);
    if (!to) break;
    const seat = from.shift()!;
    const byOrder = order === 'seed' ? [...to] : [...to].reverse();
    const candidates = byOrder.sort((a, b) => rank(a) - rank(b));
    const opponent = candidates.find((c) => !met.has(pairKey(seat.id, c.id))) ?? candidates[0];
    to.splice(to.indexOf(opponent), 1);
    pairs.push({ player_1_id: seat.id, player_2_id: opponent.id });
  }
  return pairs;
}

/**
 * The placement week's pairings (rule 3): `tables` holds each group's members in table order (group order as
 * in the plan). Same-placed trainers of different groups meet; with several groups the group order rotates per
 * place, and a trainer left over at one place meets the first free trainer of another group at the next place.
 * Among the candidates of another group a trainer prefers one it has not met yet (`met`: `pairKey`s of the
 * phase's earlier pairings), so with three or more groups a rematch happens only when every same-placed candidate
 * was met already. With two groups each place has exactly one candidate, so the same-placed rule wins over
 * avoiding a rematch (documented in docs/season.md). A trainer nobody of another group is left for (an odd total,
 * or the extra trainer of a larger group) rests. Deterministic.
 */
export function pairPlacementWeek(
  tables: readonly (readonly string[])[],
  met: ReadonlySet<string> = new Set(),
): Pairing[] {
  const groupOf = new Map<string, number>();
  tables.forEach((table, group) => table.forEach((id) => groupOf.set(id, group)));
  const places = Math.max(0, ...tables.map((table) => table.length));
  const pairs: Pairing[] = [];
  let carry: string[] = [];
  for (let place = 0; place < places; place++) {
    const rotated = tables.map((_, i) => tables[(i + place) % tables.length]);
    const pool = [...carry, ...rotated.flatMap((table) => (place < table.length ? [table[place]] : []))];
    carry = [];
    while (pool.length > 0) {
      const seat = pool.shift()!;
      const otherGroup = (other: string) => groupOf.get(other) !== groupOf.get(seat);
      const unmet = pool.findIndex((other) => otherGroup(other) && !met.has(pairKey(seat, other)));
      const index = unmet !== -1 ? unmet : pool.findIndex(otherGroup);
      if (index === -1) {
        carry.push(seat);
        continue;
      }
      const [opponent] = pool.splice(index, 1);
      pairs.push({ player_1_id: seat, player_2_id: opponent });
    }
  }
  return pairs;
}

/** The old schedule: weeks 1..R, each group's round `w` in week `w`, rest beyond its own round count. */
function planWithoutCross(groups: readonly ScheduleGroup[]): PlannedWeek[] {
  const rounds = groups.map((group) => getRoundRobinTotalRounds(group.memberIds.length));
  const total = Math.max(...rounds);
  const half = firstHalfLastWeek(total);
  const weeks: PlannedWeek[] = [];
  for (let week = 1; week <= total; week++) {
    const groupRounds: Record<string, number | null> = {};
    const groupPairings: Pairing[] = [];
    groups.forEach((group, index) => {
      if (week > rounds[index]) {
        groupRounds[group.id] = null;
        return;
      }
      groupRounds[group.id] = week;
      groupPairings.push(...generateRoundRobinRound([...group.memberIds], week).pairings);
    });
    weeks.push({
      week,
      half: week <= half ? 1 : 2,
      kind: 'group',
      groupRounds,
      groupPairings,
      crossPairings: [],
      awaitingTables: false,
    });
  }
  return weeks;
}

interface HalfInput {
  half: 1 | 2;
  inGroupRounds: readonly number[];
  startWeek: number;
}

/** Plan one half (rules 1-3) from its in-group rounds; mutates `met` with every cross pairing it schedules. */
function planHalf(
  groups: readonly ScheduleGroup[],
  rounds: readonly number[],
  input: HalfInput,
  met: Set<string>,
  phaseCross: Map<string, number>,
  placements: ReadonlyMap<number, readonly Pairing[]>,
): PlannedWeek[] {
  const seats: Seat[] = groups.flatMap((group, groupIndex) =>
    group.memberIds.map((id, seed) => ({ id, group: groupIndex, seed })),
  );
  const seatById = new Map(seats.map((seat) => [seat.id, seat]));
  const crossCount = new Map(seats.map((seat) => [seat.id, 0]));
  const weeks: PlannedWeek[] = [];
  let week = input.startWeek;

  const record = (pairs: readonly Pairing[], counts: boolean) => {
    for (const pair of pairs) {
      met.add(pairKey(pair.player_1_id, pair.player_2_id));
      for (const id of [pair.player_1_id, pair.player_2_id]) phaseCross.set(id, (phaseCross.get(id) ?? 0) + 1);
      if (counts) {
        crossCount.set(pair.player_1_id, (crossCount.get(pair.player_1_id) ?? 0) + 1);
        crossCount.set(pair.player_2_id, (crossCount.get(pair.player_2_id) ?? 0) + 1);
      }
    }
  };
  const noRounds = () => Object.fromEntries(groups.map((group) => [group.id, null])) as Record<string, null>;

  // Rule 1: in-group weeks; the trainers without an in-group match meet across groups.
  for (const round of input.inGroupRounds) {
    const groupRounds: Record<string, number | null> = {};
    const groupPairings: Pairing[] = [];
    const free: Seat[] = [];
    groups.forEach((group, groupIndex) => {
      if (round > rounds[groupIndex]) {
        groupRounds[group.id] = null;
        free.push(...seats.filter((seat) => seat.group === groupIndex));
        return;
      }
      groupRounds[group.id] = round;
      const generated = generateRoundRobinRound([...group.memberIds], round);
      groupPairings.push(...generated.pairings);
      for (const id of generated.bye_player_ids) free.push(seatById.get(id)!);
    });
    const crossPairings = crossPair(free, met, 'seed', phaseCross);
    record(crossPairings, true);
    weeks.push({ week, half: input.half, kind: 'group', groupRounds, groupPairings, crossPairings, awaitingTables: false });
    week += 1;
  }

  // Rule 2: dedicated cross weeks for the trainers still below the regular target. A week is added only while
  // two short trainers of different groups can meet: a lone short trainer (an odd total, or more short
  // trainers in one group than the others hold) never gets a week of its own; it stays short ("where
  // possible") and is served first next half (`crossPair` priority).
  for (let added = 0; added < MAX_CROSS_WEEKS_PER_HALF; added++) {
    const short = seats.filter((seat) => (crossCount.get(seat.id) ?? 0) < REGULAR_CROSS_PER_HALF);
    const pairs = crossPair(short, met, 'mirrored', phaseCross);
    if (pairs.length === 0) break;
    const playing = new Set(pairs.flatMap((pair) => [pair.player_1_id, pair.player_2_id]));
    // A short trainer no other short trainer can meet plays a trainer of another group who already reached the
    // target: fewest cross matches first, then not met yet, then mirrored seed.
    for (const seat of short) {
      if (playing.has(seat.id)) continue;
      const options = seats
        .filter((other) => other.group !== seat.group && !playing.has(other.id))
        .sort(
          (a, b) =>
            (crossCount.get(a.id) ?? 0) - (crossCount.get(b.id) ?? 0) ||
            Number(met.has(pairKey(seat.id, a.id))) - Number(met.has(pairKey(seat.id, b.id))) ||
            b.seed - a.seed ||
            a.group - b.group,
        );
      const opponent = options[0];
      if (!opponent) continue;
      pairs.push({ player_1_id: seat.id, player_2_id: opponent.id });
      playing.add(seat.id);
      playing.add(opponent.id);
    }
    record(pairs, true);
    weeks.push({
      week,
      half: input.half,
      kind: 'cross',
      groupRounds: noRounds(),
      groupPairings: [],
      crossPairings: pairs,
      awaitingTables: false,
    });
    week += 1;
  }

  // Rule 3: the placement week closes the half.
  const given = placements.get(week);
  if (given) record(given, false);
  weeks.push({
    week,
    half: input.half,
    kind: 'placement',
    groupRounds: noRounds(),
    groupPairings: [],
    crossPairings: given ? [...given] : [],
    awaitingTables: !given,
  });
  return weeks;
}

/** In-group round splits to try, closest to an even split first (ties: fewer rounds in the first half). */
function splitCandidates(totalRounds: number): number[] {
  return Array.from({ length: totalRounds + 1 }, (_, i) => i).sort(
    (a, b) => Math.abs(2 * a - totalRounds) - Math.abs(2 * b - totalRounds) || a - b,
  );
}

function planWithCross(
  groups: readonly ScheduleGroup[],
  placements: ReadonlyMap<number, readonly Pairing[]>,
): PlannedWeek[] {
  const rounds = groups.map((group) => getRoundRobinTotalRounds(group.memberIds.length));
  const total = Math.max(...rounds);
  let fallback: PlannedWeek[] | null = null;
  for (const split of splitCandidates(total)) {
    const met = new Set<string>();
    const phaseCross = new Map<string, number>();
    const first = planHalf(
      groups,
      rounds,
      { half: 1, inGroupRounds: range(1, split), startWeek: 1 },
      met,
      phaseCross,
      placements,
    );
    const second = planHalf(
      groups,
      rounds,
      { half: 2, inGroupRounds: range(split + 1, total), startWeek: first.length + 1 },
      met,
      phaseCross,
      placements,
    );
    const weeks = [...first, ...second];
    if (first.length === firstHalfLastWeek(weeks.length)) return weeks;
    fallback ??= weeks;
  }
  // Unreachable for every layout the tests enumerate (2..4 groups of 2..10); kept total so a planner change
  // that breaks the balance fails loudly in those tests, and as a coded refusal (never a generic 500) here.
  throw new GroupScheduleError(
    'no_balance',
    `group schedule: no in-group split balances the halves (${fallback?.length ?? 0} weeks)`,
  );
}

function range(from: number, to: number): number[] {
  return from > to ? [] : Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/**
 * The full week plan of a grouped round robin phase. Throws `GroupScheduleError` for a layout that cannot be
 * scheduled (no group, an empty group, a trainer in two groups, no balanced split of the halves).
 */
export function planGroupSchedule(
  groups: readonly ScheduleGroup[],
  options: GroupScheduleOptions,
): GroupSchedulePlan {
  validateGroups(groups);
  const crossGroup = options.crossGroup && groups.length >= 2;
  const weeks = crossGroup ? planWithCross(groups, options.placementPairings ?? new Map()) : planWithoutCross(groups);
  return {
    crossGroup,
    totalWeeks: weeks.length,
    firstHalfLastWeek: firstHalfLastWeek(weeks.length),
    weeks,
  };
}
