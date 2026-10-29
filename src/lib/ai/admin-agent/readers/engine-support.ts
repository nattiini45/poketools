/**
 * The engine-limits table behind the `engine_support` tool (plan 3.6.1, spec §18.13).
 *
 * Every row states a fact about code that exists today, and `__tests__/engine-support.test.ts` checks each row against
 * the constant or function it describes, so the table cannot go stale silently: when the engine learns a second
 * round-robin circle (Q22) that test fails and the row flips with it.
 */
import type { EngineGapCode } from '@/lib/format-studio/library-types';
import { PLAN_ENGINE_SUPPORT } from '../plans/engine-support';

export interface EngineSupportRow {
  readonly key: string;
  readonly supported: boolean;
  /** A number where the limit is a number (rounds per circle, roster size), otherwise null. */
  readonly limit: number | null;
  /** Plain statement for the model, characters limited to what the output schema allows. */
  readonly statement: string;
  /** What to offer the admin instead; empty when nothing fits. */
  readonly offer: string;
}

/** Engine gaps a Format Studio attach reports (`EngineGapCode`); the table below names each one. */
export const ENGINE_GAP_ROWS = [
  'rr_legs_not_run',
  'third_place_not_run',
  'edge_select_not_run',
  'override_unmapped',
  'groups_not_created',
] as const satisfies readonly EngineGapCode[];

/**
 * The circle count is the Plan's own fact (`PLAN_ENGINE_SUPPORT`, which `plans/__tests__/engine-support.test.ts` pins to the
 * engine), so the Plan's readiness check and this tool can never disagree about a double round robin.
 */
function doubleRoundRobinRow(): EngineSupportRow {
  const circles = PLAN_ENGINE_SUPPORT.roundRobinLegs;
  if (circles > 1) {
    return {
      key: 'double_round_robin',
      supported: true,
      limit: circles,
      statement: `A round robin may play up to ${circles} circles; a Format Studio legs value above that is recorded but not run`,
      offer: '',
    };
  }
  return {
    key: 'double_round_robin',
    supported: false,
    limit: circles,
    statement:
      'A round robin plays one circle only: with N players there are N-1 rounds (N for an odd count). A double round robin is refused as typed and legs 2 in a format is recorded but not run',
    offer: 'Offer a single round robin',
  };
}

export const ENGINE_SUPPORT_ROWS: readonly EngineSupportRow[] = [
  doubleRoundRobinRow(),
  {
    key: 'wildcard_threshold_advancement',
    supported: false,
    limit: null,
    statement: 'Wildcard and threshold advancement between phases are not run',
    offer: 'Offer top N per group or top N overall',
  },
  {
    key: 'format_studio_groups_legs_third_place',
    supported: false,
    limit: null,
    statement:
      'A Format Studio format may declare groups, legs, third place and bottom-N cuts, but attaching it only warns: they are recorded and not run (rr_legs_not_run, third_place_not_run, edge_select_not_run, groups_not_created)',
    offer: 'Say so before attaching and show the attach warnings',
  },
  {
    key: 'legacy_draft_roster_size',
    supported: false,
    limit: 11,
    statement: 'The legacy draft engine plays a fixed roster of 11. The queue engine used by Evolution Point Buy has a configurable roster size from 1 to 20',
    offer: '',
  },
  {
    key: 'swiss_round_count',
    supported: false,
    limit: null,
    statement: 'The number of Swiss rounds cannot be set',
    offer: '',
  },
  {
    key: 'standalone_registration',
    supported: false,
    limit: null,
    statement: 'Standalone tournaments have no registration or check-in: the admin adds participants directly',
    offer: '',
  },
  {
    key: 'start_date_is_a_label',
    supported: false,
    limit: null,
    statement:
      'A start date is only a label: nothing starts a league on that date. A league starts when its first round is generated, which also posts to Discord and social',
    offer: 'Offer a to-do for the start day',
  },
  {
    key: 'public_on_creation',
    supported: false,
    limit: null,
    statement: 'A league or standalone tournament is public the moment it exists: there is no draft or hidden state, and test leagues are still listed',
    offer: 'Rehearse in the Plan, which has no side effects',
  },
];
