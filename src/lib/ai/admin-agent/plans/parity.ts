/**
 * Schema parity (plan 3.9 test 9): the Plan must map or explicitly exclude every key of the create schemas it feeds, so
 * a `bo_overrides`-style gap cannot reappear when a route schema grows a key.
 *
 * This table is the contract. `__tests__/parity.test.ts` fails when
 *  - `seasonCreateRequestSchema`, `phaseCreateSchema` or `tournamentCreateSchema` has a key that is in neither `mapped`
 *    nor `excluded` (or in both);
 *  - a `mapped` target is not a field of the Plan slot it names;
 *  - a Plan field maps to nothing and is not a declared Plan-only field;
 *  - a body built by `route-bodies.ts` carries a key its schema would silently strip.
 *
 * `ruleset_id` is a ruleset VERSION id on all three schemas and the Plan slot is named `ruleset`; `best_of_default` is
 * the Plan's `best_of`.
 */
import type { z } from 'zod';
import { phaseCreateSchema, seasonCreateRequestSchema, tournamentCreateSchema } from '@/lib/validation/schemas';
import { planLeagueSchema, planPhaseSchema, planRulesetSlotSchema, planTournamentSchema } from './schema';

/** The Plan object a route key maps to, and its field name there. */
export type ParityTarget =
  | { slot: 'league'; field: string }
  | { slot: 'phase'; field: string }
  | { slot: 'tournament'; field: string }
  /** The ruleset slot: the key is satisfied by the slot's `existing.version_id` (or `auto_epb`, which omits it). */
  | { slot: 'ruleset'; field: string };

export interface RouteParityEntry {
  /** The route this schema validates. */
  route: string;
  schema: z.ZodObject;
  mapped: Readonly<Record<string, ParityTarget>>;
  /** Route keys the Plan never sends, with the reason. */
  excluded: Readonly<Record<string, string>>;
}

export const ROUTE_SCHEMA_PARITY = {
  seasonCreateRequestSchema: {
    route: 'POST /api/seasons',
    schema: seasonCreateRequestSchema,
    mapped: {
      name: { slot: 'league', field: 'name' },
      description: { slot: 'league', field: 'description' },
      format_type: { slot: 'league', field: 'format_type' },
      ruleset_id: { slot: 'ruleset', field: 'version_id' },
      start_date: { slot: 'league', field: 'start_date' },
      end_date: { slot: 'league', field: 'end_date' },
      language: { slot: 'league', field: 'language' },
      clone_from: { slot: 'league', field: 'clone_from' },
    },
    excluded: {
      route_theme: 'Presentation choice of the 3D world; the admin sets it in the league settings, never the assistant.',
    },
  },
  phaseCreateSchema: {
    route: 'POST /api/seasons/[id]/phases',
    schema: phaseCreateSchema,
    mapped: {
      name: { slot: 'phase', field: 'name' },
      description: { slot: 'phase', field: 'description' },
      bracket_type: { slot: 'phase', field: 'bracket_type' },
      ruleset_id: { slot: 'phase', field: 'ruleset' },
      best_of_default: { slot: 'phase', field: 'best_of' },
      bo_overrides: { slot: 'phase', field: 'bo_overrides' },
      is_doubles: { slot: 'phase', field: 'is_doubles' },
      team_visibility: { slot: 'phase', field: 'team_visibility' },
      bracket_reset_enabled: { slot: 'phase', field: 'bracket_reset_enabled' },
      advancement_rule: { slot: 'phase', field: 'advancement_rule' },
    },
    excluded: {
      insert_at: 'Phases are created in Plan order at the end; inserting before a started phase is refused (PHASE_INSERT_LOCKED).',
      stage_order: 'Set by the route from the phase position; the Plan orders phases by array position.',
    },
  },
  tournamentCreateSchema: {
    route: 'POST /api/tournaments',
    schema: tournamentCreateSchema,
    mapped: {
      name: { slot: 'tournament', field: 'name' },
      description: { slot: 'tournament', field: 'description' },
      bracket_type: { slot: 'tournament', field: 'bracket_type' },
      ruleset_id: { slot: 'tournament', field: 'ruleset' },
      best_of_default: { slot: 'tournament', field: 'best_of' },
      bo_overrides: { slot: 'tournament', field: 'bo_overrides' },
      is_doubles: { slot: 'tournament', field: 'is_doubles' },
      team_visibility: { slot: 'tournament', field: 'team_visibility' },
      bracket_reset_enabled: { slot: 'tournament', field: 'bracket_reset_enabled' },
    },
    excluded: {
      season_id: 'Refused by the route (TOURNAMENT_SEASON_ID_DEPRECATED): a league phase is created through the phases route.',
      stage_order: 'Only meaningful for a league phase; a standalone tournament has no stage.',
    },
  },
} as const satisfies Record<string, RouteParityEntry>;

/**
 * Plan fields with no route key: the Plan's own handles. Everything else in a slot object must be the target of a
 * `mapped` entry above.
 */
export const PLAN_ONLY_FIELDS = {
  league: [] as const,
  phase: ['key'] as const,
  tournament: [] as const,
} as const;

/** The fields a Plan slot object (or, for `ruleset`, any of its modes) defines. */
export function planSlotFields(slot: ParityTarget['slot']): string[] {
  switch (slot) {
    case 'league':
      return Object.keys(planLeagueSchema.shape);
    case 'phase':
      return Object.keys(planPhaseSchema.shape);
    case 'tournament':
      return Object.keys(planTournamentSchema.shape);
    case 'ruleset':
      return [...new Set(planRulesetSlotSchema.options.flatMap((option) => Object.keys(option.shape)))];
  }
}
