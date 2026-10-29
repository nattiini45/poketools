/**
 * The Build operations a Plan can derive (plan 3.6.6 and 4.4), with what the code knows about each before any route
 * runs: the guard its route uses, what it creates, which state fingerprints guard it (4.5 "Preconditions"), the
 * read-back that proves it, and how it is reversed (4.7).
 *
 * This is data about the Plan's own steps. The route bindings (method, path template, body schema) live in the
 * registry and `_ops/g`; the executor resolves each `op` there and never trusts a stored step as logic.
 */

export const PLAN_OPS = ['league_create', 'roster_add', 'phase_create', 'groups_set', 'draft_pool_create', 'tournament_create', 'tournament_participant_add'] as const;
export type PlanOp = (typeof PLAN_OPS)[number];

/** What undo can do for an op (compensating only; nothing here hard-deletes, plan 4.7). */
export type ReversalKind =
  | 'archive_league'
  | 'archive_tournament'
  | 'remove_roster'
  | 'remove_tournament_participant'
  | 'clear_groups'
  /** No reversal: the row stays behind as "archived residue" of an archived league. */
  | 'none';

/**
 * The kinds of state of a league that a precondition read fingerprints, so a step that changes one of them is not taken for
 * a step that changes all of them: `state` (status, dates), `phases`, `roster`, `drafts`.
 */
export const PLAN_STATE_DOMAINS = ['state', 'phases', 'roster', 'drafts'] as const;
export type PlanStateDomain = (typeof PLAN_STATE_DOMAINS)[number];

/** The domain each season-scoped state read looks at. A read that is not listed (a name lookup) belongs to none. */
export const READ_STATE_DOMAIN: Readonly<Record<string, PlanStateDomain>> = Object.freeze({
  season_state: 'state',
  phase_stage_order: 'phases',
  roster_hash: 'roster',
  tournament_roster_hash: 'roster',
  draft_pool_state: 'drafts',
});

export type PlanEntityType = 'season' | 'tournament' | 'draft_pool' | 'season_roster' | 'tournament_roster' | 'season_groups';

export interface PlanOpInfo {
  /** The guard the route runs first (the vocabulary of the route-manifest test). */
  guard: 'requireAnyAdmin' | 'requireResourceAdmin';
  /** The entity a step of this op creates or changes, and whether it counts toward the 10-creating-steps cap. */
  entityType: PlanEntityType;
  creates: boolean;
  /** Names of the pure state reads whose hash is stored at staging and recomputed at execution. */
  reads: readonly string[];
  /**
   * The state domains of the league this op changes, conservatively (a status or date may move with it). A later step's read
   * of a domain no earlier step changes is fingerprinted at staging, so a change by someone else in between is detected.
   */
  changes: readonly PlanStateDomain[];
  /** Name of the read-back that must pass before the step is `ok`. */
  verify: string;
  reversal: ReversalKind;
}

export const PLAN_OP_INFO: Readonly<Record<PlanOp, PlanOpInfo>> = Object.freeze({
  league_create: {
    guard: 'requireAnyAdmin',
    entityType: 'season',
    creates: true,
    reads: ['league_name_recent'],
    changes: PLAN_STATE_DOMAINS,
    verify: 'season_exists',
    reversal: 'archive_league',
  },
  roster_add: {
    guard: 'requireResourceAdmin',
    entityType: 'season_roster',
    creates: false,
    reads: ['roster_hash'],
    changes: ['roster', 'state'],
    verify: 'roster_contains',
    reversal: 'remove_roster',
  },
  phase_create: {
    guard: 'requireResourceAdmin',
    entityType: 'tournament',
    creates: true,
    reads: ['season_state', 'phase_stage_order'],
    changes: ['phases', 'state'],
    // The phase route is not atomic: the read-back checks the enrollment source and the participant count.
    verify: 'phase_enrolled',
    reversal: 'none',
  },
  groups_set: {
    guard: 'requireResourceAdmin',
    entityType: 'season_groups',
    creates: false,
    reads: ['roster_hash', 'season_state'],
    changes: ['roster', 'state'],
    verify: 'groups_match',
    reversal: 'clear_groups',
  },
  draft_pool_create: {
    guard: 'requireResourceAdmin',
    entityType: 'draft_pool',
    creates: true,
    reads: ['season_state', 'draft_pool_state'],
    changes: ['drafts', 'state'],
    verify: 'draft_pool_exists',
    reversal: 'none',
  },
  tournament_create: {
    guard: 'requireAnyAdmin',
    entityType: 'tournament',
    creates: true,
    reads: ['tournament_name_recent'],
    changes: [],
    // The creator-admin grant is best-effort in the route: the read-back is `created_but_unadministrable` otherwise.
    verify: 'tournament_administrable',
    reversal: 'archive_tournament',
  },
  // One player per call (the route takes one). The tournament must be `upcoming`; the removal is refused once it has started.
  tournament_participant_add: {
    guard: 'requireResourceAdmin',
    entityType: 'tournament_roster',
    creates: false,
    reads: ['tournament_roster_hash'],
    changes: ['roster'],
    verify: 'tournament_participant_present',
    reversal: 'remove_tournament_participant',
  },
});

/** At most this many steps, and this many entity-creating steps, per Build (spec §18.3). */
export const BUILD_LIMITS = Object.freeze({ steps: 40, creating: 10 });
