/**
 * The slot-shape cheat-sheet of the Plan tools (`plan_set`, `plan_patch`), written once and put into their descriptions.
 *
 * The model cannot discover the Plan's slot shapes any other way: `plan_set` takes JSON text, so the registry's schema
 * says nothing about the value, and a refusal names only paths and machine codes. A guessed shape costs a step each, so
 * the descriptions carry one valid example per slot. The examples are data here and rendered into the descriptions, and
 * `__tests__/plan-shapes.test.ts` parses every one with the real slot schemas (`PLAN_SLOT_SCHEMAS`) and checks the
 * enumerations against the schemas they mirror, so the text cannot drift from `plans/schema.ts`.
 *
 * `<...>` marks a value the model must read from a tool or the admin (an id it was given, a name). The test swaps each
 * one for a valid id before parsing. Nothing here is a default the assistant may pick on the admin's behalf.
 */

/** One valid value per slot, in the order the description lists them. */
export const PLAN_SLOT_EXAMPLES = {
  ruleset: { mode: 'existing', version_id: '<current_version.id from ruleset_list>' },
  format: { mode: 'none' },
  league: { name: '<league name>', format_type: 'singles', language: 'en' },
  phases: [
    { key: 'groups', name: '<phase name>', bracket_type: 'round_robin', best_of: 3, is_doubles: false, ruleset: 'plan' },
    {
      key: 'playoffs',
      name: '<phase name>',
      bracket_type: 'single_elim',
      best_of: 3,
      is_doubles: false,
      ruleset: 'plan',
      advancement_rule: { type: 'top_n', count: 4 },
    },
  ],
  roster: { entries: [{ input: '<name as typed>', state: 'resolved', player_id: '<player id from a search>' }], target_count: 8 },
  groups: { mode: 'serpentine', count: 2 },
  draft: [{ engine: 'queue', budget: 100 }],
  tournament: {
    name: '<tournament name>',
    bracket_type: 'single_elim',
    best_of: 3,
    is_doubles: false,
    team_visibility: 'hidden_until_match',
    ruleset: 'plan',
  },
} as const;

/** The enumerations the shapes name, mirrored from `@/lib/validation/schemas` (a test compares them). */
export const PLAN_SHAPE_ENUMS = {
  bracket_type: ['single_elim', 'double_elim', 'round_robin', 'swiss'],
  format_type: ['singles', 'doubles', 'draft', 'evolution_point_buy', 'custom'],
  team_visibility: ['hidden_until_match', 'always_public'],
  language: ['en', 'de'],
  ruleset_modes: ['existing', 'draft', 'new', 'fork', 'auto_epb'],
  roster_states: ['resolved', 'candidates', 'unresolved', 'skipped'],
} as const;

/** The operations `plan_patch` documents: one slot edit by path, and an assumption appended with `-`. */
export const PLAN_PATCH_EXAMPLES = {
  replace: { op: 'replace', path: '/slots/phases/1/advancement_rule/count', value: 4 },
  assumption: { op: 'add', path: '/assumptions/-', value: { key: 'start_time', value: 'evening', source: 'default', confirmed: false } },
} as const;

const json = (value: unknown): string => JSON.stringify(value);
const list = (values: readonly string[]): string => values.join(', ');

const E = PLAN_SHAPE_ENUMS;
const X = PLAN_SLOT_EXAMPLES;

/** The `plan_set` description. One line, no double spaces (the registry test requires it). */
export const PLAN_SET_DESCRIPTION = [
  'Replace one slot of the Plan wholesale: ruleset, format, league, phases, roster, groups, draft or tournament.',
  'value_json is the slot value as JSON text. It is checked against the real route schemas and the Plan readiness is recomputed. Use plan_patch for a small change.',
  'Set one slot per call; a refused call makes the later calls of the same step fail.',
  `Shapes (<...> is a value you read from a tool or the admin, never an id you made up): ruleset ${json(X.ruleset)} (modes: ${list(E.ruleset_modes)}); format ${json(X.format)};`,
  `league ${json(X.league)} plus optional description, start_date and end_date (YYYY-MM-DD), and no ruleset inside it (format_type: ${list(E.format_type)}; language: ${list(E.language)});`,
  `phases ${json(X.phases)} (bracket_type: ${list(E.bracket_type)}; best_of is odd, 1 to 15; ruleset is "plan" for the Plan's ruleset slot or {"id":"<ruleset version id>"});`,
  'advancement_rule goes on the phase that RECEIVES the qualifiers, never on the first phase, and per_group defaults to false;',
  `roster ${json(X.roster)}, where an entry is state resolved (with player_id), candidates (with player_ids), unresolved or skipped (input only);`,
  `groups ${json(X.groups)} or {"mode":"none"}; draft ${json(X.draft)} (engine: legacy or queue; group_key optional);`,
  `tournament ${json(X.tournament)} (team_visibility: ${list(E.team_visibility)}).`,
  "Literal values in these shapes (best of 3, top 4, 2 groups, budget 100, language en, 8 players) only show the shape; use the admin's values, or ask with request_clarification and record a default as an assumption.",
].join(' ');

/** The `plan_patch` description. */
export const PLAN_PATCH_DESCRIPTION = [
  'Change part of the Plan with RFC 6901 operations (add, replace, remove) given as JSON text in ops_json.',
  'Paths start at the Plan root and may touch /title, /assumptions and /slots/<slot>, for example',
  `${json(PLAN_PATCH_EXAMPLES.replace)} or ${json(PLAN_PATCH_EXAMPLES.assumption)} (an assumption has key, value, source admin, default or inferred, and confirmed).`,
  'A double round robin is the assumption legs.<phase key> = the number 2, on an existing phase.',
  'A refused operation comes back with its reason and nothing is applied. The Plan is re-validated and its readiness recomputed after each patch.',
].join(' ');
