import type { BracketType, TournamentStatus } from '@/types/tournament';
import type { Round } from '@/types/round';

/**
 * Start-up checklist of the round manager (standalone tournaments and league phases): what has to be in place
 * before Generate can work, and whether a round the admin generated still waits for its Start.
 *
 * Pure and client-safe (type-only imports). The server stays the authority: every blocking item here is a
 * rule the generate routes enforce too (`tournament_participants_too_few`, `rounds_all_generated`,
 * `tournament_current_round_incomplete`); the checklist only explains it before the admin presses Generate.
 */

/** Fewest participants any format can pair. */
export const MIN_PARTICIPANTS = 2;

export type StartupItemId =
  | 'participants'
  | 'ruleset'
  | 'bestOf'
  | 'groups'
  | 'seeding'
  | 'previousRound'
  | 'roundsRemaining';

/** Only `blocked` disables Generate. */
export type StartupItemState = 'done' | 'blocked' | 'attention' | 'unknown';

/** Where the control that fixes an item lives; the page maps it to an anchor or href. */
export type StartupLinkTarget = 'participants' | 'overview' | 'rounds' | 'leagueGroups';

export interface StartupItem {
  id: StartupItemId;
  state: StartupItemState;
  /** Values for the item's catalog message: count, min, unseeded, round (name or number), total, generated, name, bestOf. */
  params: Record<string, string | number>;
  link?: StartupLinkTarget;
}

export interface StartupChecklistInput {
  bracketType: BracketType;
  tournamentStatus: TournamentStatus;
  rulesetSet: boolean;
  rulesetName: string | null;
  bestOfDefault: number;
  /** `null` while the participants load or when loading failed. */
  participants: { count: number; seededCount: number; playerIds: readonly string[] } | null;
  rounds: readonly Pick<Round, 'name' | 'round_number' | 'status' | 'bracket_side'>[];
  groupsInUse: boolean;
  /** Player id to league group id; `null` when the phase does not mirror league groups. */
  leagueGroupOf: Readonly<Record<string, string>> | null;
}

export interface RoundRobinProgress {
  /** Rounds a round robin of this size has (circle method). */
  total: number;
  /** Distinct round numbers within 1..total that exist. */
  generated: number;
  allGenerated: boolean;
  /** The highest round number already reaches the last round, so Generate Next has nothing after it. */
  pastLast: boolean;
  /** Lowest round number within 1..total that does not exist yet. */
  firstMissing: number | null;
}

export interface StartupChecklist {
  items: StartupItem[];
  /** True when any item is `blocked`. */
  blocked: boolean;
  /** Non-null only for a round robin without groups and with known participants. */
  roundRobin: RoundRobinProgress | null;
}

/** Circle method: an even field plays n - 1 rounds, an odd one n (one sits out each round). */
function roundRobinTotal(participantCount: number): number {
  const total = participantCount % 2 === 0 ? participantCount - 1 : participantCount;
  return Math.max(0, total);
}

export function roundRobinProgress(
  participantCount: number,
  rounds: readonly Pick<Round, 'round_number'>[],
): RoundRobinProgress {
  const total = roundRobinTotal(participantCount);
  const present = new Set<number>();
  let highest = 0;
  for (const round of rounds) {
    highest = Math.max(highest, round.round_number);
    if (round.round_number >= 1 && round.round_number <= total) present.add(round.round_number);
  }
  let firstMissing: number | null = null;
  for (let n = 1; n <= total; n++) {
    if (!present.has(n)) {
      firstMissing = n;
      break;
    }
  }
  return {
    total,
    generated: present.size,
    allGenerated: total > 0 && present.size >= total,
    pastLast: total > 0 && highest >= total,
    firstMissing,
  };
}

/**
 * The round the admin should start next: the lowest-numbered pending round, provided every round before it is
 * completed (a pending round behind an active or unfinished one is not startable yet).
 */
export function nextRoundToStart<R extends Pick<Round, 'round_number' | 'status'>>(
  rounds: readonly R[],
): R | null {
  let next: R | null = null;
  for (const round of rounds) {
    if (round.status === 'pending' && (next === null || round.round_number < next.round_number)) next = round;
  }
  if (!next) return null;
  const number = next.round_number;
  return rounds.some((round) => round.round_number < number && round.status !== 'completed') ? null : next;
}

function isElimination(bracketType: BracketType): boolean {
  return bracketType === 'single_elim' || bracketType === 'double_elim';
}

export function buildStartupChecklist(input: StartupChecklistInput): StartupChecklist {
  const { bracketType, rounds, participants } = input;
  const isRoundRobin = bracketType === 'round_robin';
  const roundRobin =
    isRoundRobin && !input.groupsInUse && participants
      ? roundRobinProgress(participants.count, rounds)
      : null;

  // Nothing is left to generate: a finished tournament, or an elimination bracket the bracket engine already
  // built (its rounds carry a bracket side).
  if (input.tournamentStatus === 'completed') return { items: [], blocked: false, roundRobin };
  if (isElimination(bracketType) && rounds.some((round) => round.bracket_side != null)) {
    return { items: [], blocked: false, roundRobin };
  }

  const items: StartupItem[] = [];

  if (rounds.length === 0) {
    // Setup mode: the first Generate.
    if (participants === null) {
      items.push({ id: 'participants', state: 'unknown', params: { min: MIN_PARTICIPANTS }, link: 'participants' });
    } else {
      items.push({
        id: 'participants',
        state: participants.count < MIN_PARTICIPANTS ? 'blocked' : 'done',
        params: { count: participants.count, min: MIN_PARTICIPANTS },
        link: 'participants',
      });
    }

    items.push({
      id: 'ruleset',
      state: input.rulesetSet ? 'done' : 'blocked',
      params: input.rulesetName ? { name: input.rulesetName } : {},
      link: 'overview',
    });

    items.push({
      id: 'bestOf',
      state: Number.isInteger(input.bestOfDefault) && input.bestOfDefault >= 1 ? 'done' : 'blocked',
      params: { count: input.bestOfDefault, bestOf: input.bestOfDefault },
      link: 'overview',
    });

    if (input.leagueGroupOf && participants) {
      const groupOf = input.leagueGroupOf;
      const unplaced = participants.playerIds.filter(
        (id) => !Object.prototype.hasOwnProperty.call(groupOf, id),
      ).length;
      items.push({
        id: 'groups',
        state: unplaced > 0 ? 'blocked' : 'done',
        params: { count: unplaced },
        link: 'leagueGroups',
      });
    }

    if (participants && participants.count >= MIN_PARTICIPANTS) {
      const unseeded = Math.max(0, participants.count - participants.seededCount);
      items.push({
        id: 'seeding',
        state: unseeded > 0 ? 'attention' : 'done',
        params: { unseeded, count: participants.count },
        link: 'participants',
      });
    }
  } else {
    // Next-round mode: Swiss, round robin and legacy elimination (rounds without a bracket side).
    if (!isRoundRobin) {
      let last = rounds[0];
      for (const round of rounds) if (round.round_number > last.round_number) last = round;
      items.push({
        id: 'previousRound',
        state: last.status === 'completed' ? 'done' : 'blocked',
        params: { round: last.name },
        link: 'rounds',
      });
    }

    if (roundRobin) {
      const state: StartupItemState = roundRobin.allGenerated
        ? 'blocked'
        : roundRobin.pastLast && roundRobin.firstMissing !== null
          ? 'attention'
          : 'done';
      items.push({
        id: 'roundsRemaining',
        state,
        params: {
          total: roundRobin.total,
          generated: roundRobin.generated,
          ...(state === 'attention' && roundRobin.firstMissing !== null ? { round: roundRobin.firstMissing } : {}),
        },
      });
    }
  }

  return { items, blocked: items.some((item) => item.state === 'blocked'), roundRobin };
}
