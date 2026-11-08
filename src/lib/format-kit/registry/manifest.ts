/**
 * The primitive manifest: one plain-data entry per kind (available and reserved) and the Spec of
 * every available kind. It is the single data source for the browser validator (`DOCUMENT_SPEC` is
 * built from it) and for the Studio forms later; the server twin is `server.ts` (zod params
 * schemas, one per available kind).
 *
 * Levels state the enforcement of a primitive ("auto" the engine runs it, "checked" an admin
 * confirms a computed result, "honor" a rule card nobody enforces). The badge is metadata here; the
 * kit engine (`src/lib/format-engine`, `src/lib/format-engine/runtime`) is what runs the "auto" kinds
 * of a league attached on it. A team constraint is "checked": the app evaluates it as advisory feedback
 * while a team is built and saved and audits the team a player played (a `team_audit` check); nothing
 * refuses a team, an admin confirms the audit's result. Reserved kinds are listed so a document that
 * names them fails with `not_available_yet`.
 *
 * Adding a primitive: one entry here, its zod params schema in `schema/primitives.ts`, its
 * describe function in `describe.ts`, its catalog keys in `format-studio/primitives`, and tests.
 *
 * Zero zod, no server-only import.
 */
import { deepFreeze } from '@/lib/studio-core/json';
import {
  CALENDAR_DATE_CHARS,
  CALENDAR_TIME_CHARS,
  MAX_ACTION_STEPS,
  MAX_BEST_OF,
  MAX_BIPARTITE_ROUNDS,
  MAX_CALENDAR_EVERY,
  MAX_CALENDAR_MARKS,
  MAX_CALENDAR_ROUND,
  MAX_CALENDAR_OFFSET_HOURS,
  MAX_CALENDAR_WINDOW_HOURS,
  MAX_CAPACITY,
  MAX_CHALLENGE_COOLDOWN,
  MAX_CHALLENGE_OPEN,
  MAX_CHALLENGE_RANK_RANGE,
  MAX_CHALLENGE_ROUNDS,
  MAX_CHALLENGE_WINDOW_HOURS,
  MAX_COLUMNS,
  MAX_COUNT_ANY_OF,
  MAX_COUNT_SOURCE_DEPTH,
  MAX_COUNT_SPECIES,
  MAX_DEADLINES,
  MAX_DOMAIN_ENTRIES,
  MAX_CONSTRAINTS,
  MAX_EFFECTS,
  MAX_END_ROUNDS,
  MAX_ENTRY_ATTRS,
  MAX_ENUM_VALUES,
  MAX_EVENT_ROUND,
  MAX_EXPECTED_COUNT,
  MAX_FACTS,
  MAX_GRANT,
  MAX_GROUPS,
  MAX_LEGS,
  MAX_MULTI_VALUES,
  MAX_N,
  MAX_N_PER_GROUP,
  MAX_OVERRIDE_ROUND,
  MAX_OVERRIDES,
  MAX_PLACEMENT_POINTS,
  MAX_PLAYERS_PER_MATCH,
  MAX_QUOTA_TYPES,
  MAX_TYPE_NAME_CHARS,
  MAX_RANK_STEPS,
  MAX_SELECTS,
  MAX_SIDE_VALUES,
  MAX_STEP_COUNT,
  MAX_SWISS_ROUNDS,
  MAX_TABLE_VALUES,
  MAX_TEAM_SIZE,
  MAX_TRACK_STEPS,
  MAX_VIEW_STAGES,
  MIN_COUNT_ANY_OF,
  MIN_GROUPS,
  MIN_PLAYERS_PER_MATCH,
  SCORE_ABS_MAX,
} from '../limits';
import { LTEXT_MAX_CHARS } from '@/lib/studio-core/ltext';
import {
  AVAILABLE_KINDS,
  ADJUST_KINDS,
  PRIMITIVE_KINDS,
  RESERVED_KINDS,
  kindKey,
  type AvailableKind,
  type PrimitiveKind,
  type ReservedKind,
} from './kinds';
import { NO_MAX, NUM_MAX, NUM_MIN, type FieldSpec, type JsonDefault, type Spec } from './spec';

export { kindKey };

/** Top-level document sections that are reserved for later phases. */
export const RESERVED_SECTIONS: readonly string[] = [];
/** Stage fields that are reserved for later phases. */
export const RESERVED_STAGE_FIELDS = ['acquire'] as const;
/** Pairing kinds (the tag after `pairing.`) that are reserved for later phases. */
export const RESERVED_PAIRING_TAGS: readonly string[] = [];
/** Rule kinds that are reserved for later phases. */
export const RESERVED_RULE_KINDS: readonly string[] = [];

/**
 * Reserved kinds that are neither a pairing tag nor a rule kind, with the stage field that will carry them.
 */
export const RESERVED_KIND_OWNERS: ReadonlyMap<ReservedKind, string> = new Map<ReservedKind, string>([
  ['acquire.draft', 'acquire'],
]);

export type ManifestSlot =
  | 'stage'
  | 'group'
  | 'pairing'
  | 'series'
  | 'ruleset'
  | 'scoring'
  | 'rank'
  | 'standings'
  | 'advance'
  | 'rule'
  | 'text'
  | 'theme'
  | 'module'
  | 'attribute'
  | 'assign'
  | 'domain'
  | 'relation'
  | 'resource'
  | 'metric'
  | 'effect'
  | 'constraint'
  | 'calendar'
  | 'deadline'
  | 'end_when'
  | 'foreach_group'
  | 'reserved';

export type PrimitiveLevel = 'auto' | 'checked' | 'honor';

export interface ManifestEntry {
  kind: PrimitiveKind;
  slot: ManifestSlot;
  /** The union tag value in the document (`swiss` for `pairing.swiss`, `rule.custom` for a rule card); null for a plain node. */
  tag: string | null;
  level: PrimitiveLevel;
  availability: 'available' | 'reserved';
  /** The release phase that makes the primitive run (1 = today's engine). */
  phase: number;
  labelKey: string;
  summaryKey: string | null;
  describeKey: string | null;
  /** The shape of the node; null for reserved kinds. */
  spec: Spec | null;
}

// --- Spec builders ----------------------------------------------------------------------------

const KEY: Spec = { t: 'str', min: 0, max: NO_MAX, pattern: 'key' };
const UUID: Spec = { t: 'str', min: 0, max: NO_MAX, pattern: 'uuid' };
const LTEXT: Spec = { t: 'ltext' };
const BOOL: Spec = { t: 'bool' };

const int = (min: number, max: number): Spec => ({ t: 'int', min, max });
const oneOf = (...values: string[]): Spec => ({ t: 'enum', values });
const arr = (item: Spec, min: number, max: number): Spec => ({ t: 'arr', item, min, max });
const obj = (fields: readonly FieldSpec[], reserved?: readonly string[]): Spec =>
  reserved ? { t: 'obj', fields, reserved } : { t: 'obj', fields };
const req = (name: string, spec: Spec): FieldSpec => ({ name, spec });
const opt = (name: string, spec: Spec): FieldSpec => ({ name, spec, optional: true });
const dflt = (name: string, spec: Spec, value: JsonDefault): FieldSpec => ({ name, spec, default: value });
/** A union variant: an object whose `tag` field is the one-value enum. */
const variant = (tag: string, value: string, fields: readonly FieldSpec[]): Spec =>
  obj([req(tag, oneOf(value)), ...fields]);

// --- Leaf specs (the shape of one node) ---------------------------------------------------------

const ROUND_ROBIN = variant('kind', 'round_robin', [
  dflt('legs', int(1, MAX_LEGS), 1),
  dflt('mirror_legs', BOOL, true),
]);
const SWISS = variant('kind', 'swiss', [
  req('rounds', { t: 'oneof', options: [int(1, MAX_SWISS_ROUNDS), oneOf('auto')] }),
  dflt('avoid_repeats', BOOL, true),
]);
const SINGLE_ELIM = variant('kind', 'single_elim', [dflt('third_place', BOOL, false)]);
const DOUBLE_ELIM = variant('kind', 'double_elim', [dflt('bracket_reset', BOOL, false)]);
const MANUAL_PAIRING = variant('kind', 'manual', []);

const RANK_METRIC = variant('kind', 'metric', [req('metric', KEY), req('direction', oneOf('desc', 'asc'))]);
const RANK_HEAD_TO_HEAD = variant('kind', 'head_to_head', [req('scope', oneOf('pairwise', 'mini_table'))]);
const RANK_COIN_FLIP = variant('kind', 'coin_flip', []);
const RANK_DECISION_MATCH = variant('kind', 'decision_match', []);
const RANK_MANUAL = variant('kind', 'manual', []);

const SELECT_TOP_N = variant('kind', 'top_n', [req('n', int(1, MAX_N))]);
const SELECT_PER_GROUP = variant('kind', 'per_group', [req('n', int(1, MAX_N_PER_GROUP))]);
const SELECT_WILDCARD = variant('kind', 'wildcard', [req('n', int(1, MAX_N))]);
const SELECT_THRESHOLD = variant('kind', 'threshold', [req('when', { t: 'expr', type: 'boolean' })]);
const SELECT_BOTTOM_N = variant('kind', 'bottom_n', [req('n', int(1, MAX_N))]);
const SELECT_MANUAL_LIST = variant('kind', 'manual_list', [opt('count', int(1, MAX_N))]);

const GROUPS = obj([
  req('count', int(MIN_GROUPS, MAX_GROUPS)),
  dflt('method', oneOf('serpentine', 'straight', 'random_seeded', 'manual'), 'serpentine'),
]);
const SERIES = obj([
  req('best_of', int(1, MAX_BEST_OF)),
  dflt('allow_draw', BOOL, false),
  dflt(
    'overrides',
    arr(
      obj([req('round', int(1, MAX_OVERRIDE_ROUND)), dflt('from', oneOf('start', 'end'), 'start'), req('best_of', int(1, MAX_BEST_OF))]),
      0,
      MAX_OVERRIDES,
    ),
    [],
  ),
]);
const RULESET: Spec = {
  t: 'union',
  tag: 'kind',
  variants: [
    { tag: 'season_default', spec: variant('kind', 'season_default', []) },
    { tag: 'ruleset', spec: variant('kind', 'ruleset', [req('id', UUID)]) },
    { tag: 'preset', spec: variant('kind', 'preset', [req('preset', KEY)]) },
  ],
};
const SCORE_NUM: Spec = { t: 'num', min: -SCORE_ABS_MAX, max: SCORE_ABS_MAX };
const FORFEIT_SCORING = obj([req('win', SCORE_NUM), dflt('loss', SCORE_NUM, 0), dflt('faint_bonus', BOOL, false)]);
const SCORING = obj([
  req('win', SCORE_NUM),
  dflt('loss', SCORE_NUM, 0),
  dflt('bye', SCORE_NUM, 0),
  opt('draw', SCORE_NUM),
  opt('forfeit', { t: 'oneof', options: [SCORE_NUM, FORFEIT_SCORING] }),
  opt('per_opponent_faint', { t: 'num', min: 0, max: SCORE_ABS_MAX }),
]);
const PARTICIPANTS: Spec = {
  t: 'union',
  tag: 'from',
  variants: [
    {
      tag: 'roster',
      spec: variant('from', 'roster', [
        req('seeding', oneOf('rating', 'random', 'manual', 'signup')),
        opt('expected_count', int(2, MAX_EXPECTED_COUNT)),
      ]),
    },
    { tag: 'edges', spec: variant('from', 'edges', [req('seeding', oneOf('edge_order', 'rating', 'random', 'manual'))]) },
  ],
};

const STANDINGS_VIEW = obj([
  req('key', KEY),
  req('label', LTEXT),
  req('stages', arr(KEY, 2, MAX_VIEW_STAGES)),
  req('metric', KEY),
  req('combine', oneOf('sum')),
]);
const RULE_CUSTOM = variant('kind', 'rule.custom', [
  req('id', KEY),
  req('text', LTEXT),
  dflt(
    'scope',
    {
      t: 'union',
      tag: 'kind',
      variants: [
        { tag: 'season', spec: variant('kind', 'season', []) },
        { tag: 'stage', spec: variant('kind', 'stage', [req('stage', KEY)]) },
      ],
    },
    { kind: 'season' },
  ),
  dflt('verify', oneOf('admin_checklist', 'player_attest', 'none'), 'admin_checklist'),
  dflt('when', oneOf('once', 'per_match', 'per_matchday'), 'once'),
  dflt('visible_to_players', BOOL, true),
  opt('degraded_from', { t: 'str', min: 0, max: NO_MAX, pattern: 'kind' }),
]);
const TEXT_SECTION = obj([req('id', KEY), req('title', LTEXT), req('body', LTEXT), opt('stage', KEY)]);
const THEME = obj([dflt('world', KEY, 'auto')]);
const LEGACY_FACT = obj([
  req('key', KEY),
  req('label', LTEXT),
  req('value', {
    t: 'oneof',
    options: [
      { t: 'str', min: 0, max: LTEXT_MAX_CHARS, pattern: 'text' },
      { t: 'num', min: NUM_MIN, max: NUM_MAX },
      BOOL,
    ],
  }),
]);
const MODULE_LEGACY = variant('kind', 'module.legacy', [
  req('adapter', oneOf('epb', 'legacy_draft', 'core_liga')),
  dflt('facts', arr(LEGACY_FACT, 0, MAX_FACTS), []),
]);

// --- Phase 3 leaf specs ---------------------------------------------------------------------------

const EXPR_BOOL: Spec = { t: 'expr', type: 'boolean' };
const NUMBER: Spec = { t: 'num', min: NUM_MIN, max: NUM_MAX };
const TEXT_VALUE: Spec = { t: 'str', min: 0, max: LTEXT_MAX_CHARS, pattern: 'text' };
/** A scalar attribute or flag value. */
const SCALAR: Spec = { t: 'oneof', options: [TEXT_VALUE, NUMBER, BOOL] };

const ATTR_ASSIGN: Spec = {
  t: 'union',
  tag: 'kind',
  variants: [
    { tag: 'manual', spec: variant('kind', 'manual', []) },
    { tag: 'random_seeded', spec: variant('kind', 'random_seeded', []) },
    { tag: 'expr', spec: variant('kind', 'expr', [req('expr', { t: 'expr', type: 'any' })]) },
  ],
};
const ATTRIBUTE_DEF = obj([
  req('key', KEY),
  req('label', LTEXT),
  req('on', oneOf('player', 'entry')),
  req('type', oneOf('enum', 'number', 'text', 'bool')),
  opt('values', arr(KEY, 1, MAX_ENUM_VALUES)),
  opt('multi', BOOL),
  opt('assign', ATTR_ASSIGN),
]);

const ENTRY_ATTR = obj([
  req('key', KEY),
  req('value', { t: 'oneof', options: [TEXT_VALUE, NUMBER, BOOL, arr(KEY, 1, MAX_MULTI_VALUES)] }),
]);
const DOMAIN_ENTRY = obj([req('id', KEY), dflt('attrs', arr(ENTRY_ATTR, 0, MAX_ENTRY_ATTRS), [])]);
const DOMAIN_DEF = obj([
  req('key', KEY),
  req('label', LTEXT),
  req('entries', arr(DOMAIN_ENTRY, 1, MAX_DOMAIN_ENTRIES)),
  dflt('initially', oneOf('locked', 'unlocked'), 'unlocked'),
  dflt('visibility', oneOf('public', 'when_unlocked', 'admins'), 'public'),
]);

const STAGE_SCOPED_EVENT = (event: string): Spec => variant('event', event, [opt('stage', KEY)]);
const ROUND_EVENT = (event: string): Spec =>
  variant('event', event, [opt('stage', KEY), opt('round', int(1, MAX_EVENT_ROUND))]);
const EVENT_SPEC: Spec = {
  t: 'union',
  tag: 'event',
  variants: [
    { tag: 'stage_start', spec: STAGE_SCOPED_EVENT('stage_start') },
    { tag: 'round_start', spec: ROUND_EVENT('round_start') },
    { tag: 'round_end', spec: ROUND_EVENT('round_end') },
    { tag: 'match_completed', spec: STAGE_SCOPED_EVENT('match_completed') },
    { tag: 'action_locked', spec: variant('event', 'action_locked', [req('action', KEY)]) },
    { tag: 'stage_end', spec: STAGE_SCOPED_EVENT('stage_end') },
    { tag: 'time', spec: variant('event', 'time', [req('mark', KEY)]) },
  ],
};

const RELATION_VISIBILITY = oneOf('hidden', 'own', 'all');
const RELATION_DEF = obj([
  req('key', KEY),
  req('label', LTEXT),
  req('shape', oneOf('derangement', 'pairs', 'manual')),
  dflt('visibility', obj([req('from', RELATION_VISIBILITY), req('to', RELATION_VISIBILITY)]), { from: 'hidden', to: 'own' }),
  opt('reveal_on', EVENT_SPEC),
]);

const RESOURCE_DEF = obj([
  req('key', KEY),
  req('label', LTEXT),
  req('holds', {
    t: 'union',
    tag: 'kind',
    variants: [
      { tag: 'domain', spec: variant('kind', 'domain', [req('domain', KEY)]) },
      { tag: 'counter', spec: variant('kind', 'counter', []) },
    ],
  }),
  opt('capacity', int(1, MAX_CAPACITY)),
  dflt('visibility', oneOf('own', 'all'), 'own'),
  dflt('exclusive', oneOf('none', 'global'), 'none'),
]);

const METRIC_DEFINE = variant('kind', 'metric.define', [
  req('key', KEY),
  req('label', LTEXT),
  req('of', oneOf('player', 'match')),
  req('expr', { t: 'expr', type: 'number' }),
]);
const TRACK_PROGRESSION = variant('kind', 'track.progression', [
  req('key', KEY),
  req('label', LTEXT),
  opt('stage', KEY),
  req('steps', arr(obj([req('label', LTEXT), req('when', EXPR_BOOL)]), 1, MAX_TRACK_STEPS)),
]);
const SCORE_PLACEMENT = variant('kind', 'score.placement', [
  req('key', KEY),
  req('label', LTEXT),
  req('stage', KEY),
  req('points', arr(SCORE_NUM, 1, MAX_PLACEMENT_POINTS)),
]);

const TUNABLE_DEF = obj([
  req('key', KEY),
  req('label', LTEXT),
  req('type', oneOf('number', 'bool', 'enum', 'table')),
  req('default', { t: 'oneof', options: [NUMBER, BOOL, KEY, arr(NUMBER, 1, MAX_TABLE_VALUES)] }),
  opt('min', NUMBER),
  opt('max', NUMBER),
  opt('values', arr(KEY, 1, MAX_ENUM_VALUES)),
  dflt('editable_until', oneOf('start', 'lock', 'always'), 'start'),
  dflt('status', oneOf('experimental', 'approved'), 'experimental'),
]);

const EFFECT_TARGET = obj([dflt('who', oneOf('all', 'event_players'), 'all'), opt('where', EXPR_BOOL)]);
const TARGET_FIELD = (): FieldSpec => dflt('to', EFFECT_TARGET, { who: 'all' });
const RESOURCE_EFFECT = (effect: string): Spec =>
  variant('effect', effect, [
    req('resource', KEY),
    TARGET_FIELD(),
    dflt('amount', int(1, MAX_GRANT), 1),
    opt('item', KEY),
  ]);
const EFFECT: Spec = {
  t: 'union',
  tag: 'effect',
  variants: [
    { tag: 'unlock_domain', spec: variant('effect', 'unlock_domain', [req('domain', KEY)]) },
    { tag: 'lock_domain', spec: variant('effect', 'lock_domain', [req('domain', KEY)]) },
    { tag: 'reveal_relation', spec: variant('effect', 'reveal_relation', [req('relation', KEY)]) },
    { tag: 'generate_relation', spec: variant('effect', 'generate_relation', [req('relation', KEY)]) },
    { tag: 'grant_resource', spec: RESOURCE_EFFECT('grant_resource') },
    { tag: 'revoke_resource', spec: RESOURCE_EFFECT('revoke_resource') },
    {
      tag: 'adjust_points',
      spec: variant('effect', 'adjust_points', [req('stage', KEY), TARGET_FIELD(), req('points', SCORE_NUM)]),
    },
    { tag: 'set_attr', spec: variant('effect', 'set_attr', [req('attr', KEY), TARGET_FIELD(), req('value', SCALAR)]) },
    { tag: 'open_action', spec: variant('effect', 'open_action', [req('action', KEY)]) },
    { tag: 'lock_action', spec: variant('effect', 'lock_action', [req('action', KEY)]) },
    { tag: 'notify', spec: variant('effect', 'notify', [req('message', LTEXT), TARGET_FIELD()]) },
  ],
};

const RULE_ON_EVENT = variant('kind', 'rule.on_event', [
  req('id', KEY),
  req('on', EVENT_SPEC),
  opt('when', EXPR_BOOL),
  req('effects', arr(EFFECT, 1, MAX_EFFECTS)),
]);
const ACTION_STEP = obj([
  req('resource', KEY),
  req('domain', KEY),
  req('count', int(1, MAX_STEP_COUNT)),
  opt('where', EXPR_BOOL),
  opt('distinct_attr', KEY),
]);
const PLAYER_ACTION = variant('kind', 'player.action', [
  req('id', KEY),
  req('label', LTEXT),
  opt('via', KEY),
  dflt('window', obj([opt('opens_on', EVENT_SPEC), opt('closes_on', EVENT_SPEC)]), {}),
  req('steps', arr(ACTION_STEP, 1, MAX_ACTION_STEPS)),
  dflt('lock', oneOf('on_submit', 'on_close'), 'on_submit'),
]);
const CHECK_ASSISTED = variant('kind', 'check.assisted', [
  req('id', KEY),
  opt('label', LTEXT),
  req('source', {
    t: 'union',
    tag: 'kind',
    variants: [
      { tag: 'unresolved_outcome', spec: variant('kind', 'unresolved_outcome', []) },
      { tag: 'standings_tie', spec: variant('kind', 'standings_tie', [opt('stage', KEY)]) },
      { tag: 'pairing_rematch', spec: variant('kind', 'pairing_rematch', [opt('stage', KEY)]) },
      { tag: 'expr', spec: variant('kind', 'expr', [req('of', oneOf('player', 'match')), req('when', EXPR_BOOL)]) },
    ],
  }),
]);
const ADJUST_MANUAL = variant('kind', 'adjust.manual', [
  req('id', KEY),
  req('allow', arr(oneOf(...ADJUST_KINDS), 1, ADJUST_KINDS.length)),
]);

// --- Phase 4 leaf specs ---------------------------------------------------------------------------

const BIPARTITE = variant('kind', 'bipartite', [
  req('attr', KEY),
  req('side_a', arr(KEY, 1, MAX_SIDE_VALUES)),
  req('side_b', arr(KEY, 1, MAX_SIDE_VALUES)),
  req('rounds', int(1, MAX_BIPARTITE_ROUNDS)),
  dflt('avoid_repeats', BOOL, true),
]);
/** The pairings a filter wraps. These are copies of the swiss and round robin shapes: each manifest Spec appears once in the document. */
const FILTER_BASE: Spec = {
  t: 'union',
  tag: 'kind',
  variants: [
    {
      tag: 'swiss',
      spec: variant('kind', 'swiss', [
        req('rounds', { t: 'oneof', options: [int(1, MAX_SWISS_ROUNDS), oneOf('auto')] }),
        dflt('avoid_repeats', BOOL, true),
      ]),
    },
    {
      tag: 'round_robin',
      spec: variant('kind', 'round_robin', [dflt('legs', int(1, MAX_LEGS), 1), dflt('mirror_legs', BOOL, true)]),
    },
  ],
};
const FILTER = variant('kind', 'filter', [req('base', FILTER_BASE), req('allow', EXPR_BOOL)]);
const CHALLENGE = variant('kind', 'challenge', [
  req('rounds', int(1, MAX_CHALLENGE_ROUNDS)),
  req('rank_range', int(1, MAX_CHALLENGE_RANK_RANGE)),
  dflt('max_open', int(1, MAX_CHALLENGE_OPEN), 1),
  dflt('cooldown_rounds', int(0, MAX_CHALLENGE_COOLDOWN), 1),
  dflt('accept_window_hours', int(1, MAX_CHALLENGE_WINDOW_HOURS), 72),
]);

const TEAM_SIZE = int(1, MAX_TEAM_SIZE);
const TEAM_COUNT = int(0, MAX_TEAM_SIZE);
const WHEN_FIELD = (): FieldSpec => opt('when', EXPR_BOOL);

/** A count source with `depth` more levels of `any_of` / `not` allowed below it; the types in `types.ts` have exactly `MAX_COUNT_SOURCE_DEPTH` levels. */
function countSourceSpec(depth: number): Spec {
  const variants = [
    { tag: 'domain', spec: variant('kind', 'domain', [req('domain', KEY), dflt('unlocked_only', BOOL, false)]) },
    { tag: 'resource', spec: variant('kind', 'resource', [req('resource', KEY)]) },
    { tag: 'species', spec: variant('kind', 'species', [req('ids', arr(KEY, 1, MAX_COUNT_SPECIES))]) },
  ];
  if (depth > 0) {
    variants.push(
      {
        tag: 'any_of',
        spec: variant('kind', 'any_of', [req('sources', arr(countSourceSpec(depth - 1), MIN_COUNT_ANY_OF, MAX_COUNT_ANY_OF))]),
      },
      { tag: 'not', spec: variant('kind', 'not', [req('source', countSourceSpec(depth - 1))]) },
    );
  }
  return { t: 'union', tag: 'kind', variants };
}

const CONSTRAINT_ROSTER_SIZE = variant('kind', 'roster_size', [
  req('min', TEAM_SIZE),
  req('max', TEAM_SIZE),
  WHEN_FIELD(),
]);
const CONSTRAINT_COUNT = variant('kind', 'count', [
  req('source', countSourceSpec(MAX_COUNT_SOURCE_DEPTH)),
  opt('min', TEAM_COUNT),
  opt('max', TEAM_COUNT),
  WHEN_FIELD(),
]);
const CONSTRAINT_DISTINCT = variant('kind', 'distinct', [
  req('by', oneOf('base_species', 'species', 'item', 'type', 'attr')),
  opt('attr', KEY),
  req('max_per', TEAM_SIZE),
  WHEN_FIELD(),
]);
const CONSTRAINT_TYPE_QUOTA = variant('kind', 'type_quota', [
  req('types', {
    t: 'union',
    tag: 'source',
    variants: [
      {
        tag: 'fixed',
        spec: variant('source', 'fixed', [req('types', arr({ t: 'str', min: 1, max: MAX_TYPE_NAME_CHARS, pattern: 'text' }, 1, MAX_QUOTA_TYPES))]),
      },
      { tag: 'player_attr', spec: variant('source', 'player_attr', [req('attr', KEY)]) },
    ],
  }),
  req('min_per_type', TEAM_COUNT),
  dflt('allow_multi_count', BOOL, false),
  WHEN_FIELD(),
]);
const CONSTRAINT_TERA = variant('kind', 'tera', [
  req('mode', oneOf('banned', 'stab', 'any', 'from_attr')),
  opt('attr', KEY),
  WHEN_FIELD(),
]);
const CONSTRAINT_EVOLUTION_STAGE = variant('kind', 'evolution_stage', [
  opt('fully_evolved_max', TEAM_COUNT),
  opt('nfe_max', TEAM_COUNT),
  opt('lc_max', TEAM_COUNT),
  WHEN_FIELD(),
]);

const OFFSET_HOURS = int(-MAX_CALENDAR_OFFSET_HOURS, MAX_CALENDAR_OFFSET_HOURS);
const CALENDAR_MARK = obj([req('key', KEY), req('round', int(1, MAX_CALENDAR_ROUND)), req('offset_hours', OFFSET_HOURS)]);
const DEADLINE_POLICY = obj([
  req('applies', oneOf('action', 'match', 'team')),
  opt('action', KEY),
  req('offset_hours', OFFSET_HOURS),
  req('on_miss', oneOf('forfeit', 'admin_review', 'auto_lock', 'seeded_random_pick')),
]);
/** The date and the time of day are shape-checked by the compiler (a calendar date that does not exist is a diagnostic). */
const STAGE_CALENDAR = obj([
  req('start', {
    t: 'union',
    tag: 'kind',
    variants: [
      { tag: 'season_start', spec: variant('kind', 'season_start', []) },
      { tag: 'date', spec: variant('kind', 'date', [req('date', { t: 'str', min: 1, max: CALENDAR_DATE_CHARS, pattern: 'text' })]) },
    ],
  }),
  dflt('time', { t: 'str', min: 1, max: CALENDAR_TIME_CHARS, pattern: 'text' }, '18:00'),
  req('cadence', oneOf('weekly', 'days')),
  dflt('every', int(1, MAX_CALENDAR_EVERY), 1),
  dflt('round_window_hours', int(1, MAX_CALENDAR_WINDOW_HOURS), 168),
  dflt('marks', arr(CALENDAR_MARK, 0, MAX_CALENDAR_MARKS), []),
  dflt('deadlines', arr(DEADLINE_POLICY, 0, MAX_DEADLINES), []),
]);
const END_WHEN: Spec = {
  t: 'union',
  tag: 'kind',
  variants: [
    { tag: 'rounds', spec: variant('kind', 'rounds', [req('rounds', int(1, MAX_END_ROUNDS))]) },
    { tag: 'expr', spec: variant('kind', 'expr', [req('when', EXPR_BOOL)]) },
  ],
};
const FOREACH_GROUP = obj([req('from', KEY)]);

// --- Entries ------------------------------------------------------------------------------------

function available(
  kind: AvailableKind,
  slot: ManifestSlot,
  tag: string | null,
  spec: Spec,
  options: { level?: PrimitiveLevel; phase?: number } = {},
): ManifestEntry {
  const key = kindKey(kind);
  return {
    kind,
    slot,
    tag,
    level: options.level ?? 'auto',
    availability: 'available',
    phase: options.phase ?? 1,
    labelKey: `label.${key}`,
    summaryKey: `summary.${key}`,
    describeKey: `describe.${key}`,
    spec,
  };
}

function reservedEntry(kind: ReservedKind, phase: number): ManifestEntry {
  return {
    kind,
    slot: 'reserved',
    tag: null,
    level: 'honor',
    availability: 'reserved',
    phase,
    labelKey: `label.${kindKey(kind)}`,
    summaryKey: null,
    describeKey: null,
    spec: null,
  };
}

const PAIRING_ENTRIES: readonly ManifestEntry[] = [
  available('pairing.round_robin', 'pairing', 'round_robin', ROUND_ROBIN),
  available('pairing.swiss', 'pairing', 'swiss', SWISS),
  available('pairing.single_elim', 'pairing', 'single_elim', SINGLE_ELIM),
  available('pairing.double_elim', 'pairing', 'double_elim', DOUBLE_ELIM),
  available('pairing.manual', 'pairing', 'manual', MANUAL_PAIRING),
  available('pairing.bipartite', 'pairing', 'bipartite', BIPARTITE, { phase: 4 }),
  available('pairing.filter', 'pairing', 'filter', FILTER, { phase: 4 }),
  available('pairing.challenge', 'pairing', 'challenge', CHALLENGE, { phase: 4 }),
];
/** A team constraint: advisory feedback plus the post-match audit, so an admin confirms the result (Checked). */
function constraint(kind: Extract<AvailableKind, `constraint.${string}`>, tag: string, spec: Spec): ManifestEntry {
  return available(kind, 'constraint', tag, spec, { phase: 4, level: 'checked' });
}
const CONSTRAINT_ENTRIES: readonly ManifestEntry[] = [
  constraint('constraint.roster_size', 'roster_size', CONSTRAINT_ROSTER_SIZE),
  constraint('constraint.count', 'count', CONSTRAINT_COUNT),
  constraint('constraint.distinct', 'distinct', CONSTRAINT_DISTINCT),
  constraint('constraint.type_quota', 'type_quota', CONSTRAINT_TYPE_QUOTA),
  constraint('constraint.tera', 'tera', CONSTRAINT_TERA),
  constraint('constraint.evolution_stage', 'evolution_stage', CONSTRAINT_EVOLUTION_STAGE),
];
const RANK_ENTRIES: readonly ManifestEntry[] = [
  available('rank.metric', 'rank', 'metric', RANK_METRIC),
  available('rank.head_to_head', 'rank', 'head_to_head', RANK_HEAD_TO_HEAD),
  available('rank.coin_flip', 'rank', 'coin_flip', RANK_COIN_FLIP),
  available('rank.decision_match', 'rank', 'decision_match', RANK_DECISION_MATCH),
  available('rank.manual', 'rank', 'manual', RANK_MANUAL),
];
const SELECT_ENTRIES: readonly ManifestEntry[] = [
  available('advance.top_n', 'advance', 'top_n', SELECT_TOP_N),
  available('advance.per_group', 'advance', 'per_group', SELECT_PER_GROUP),
  available('advance.wildcard', 'advance', 'wildcard', SELECT_WILDCARD, { phase: 2 }),
  available('advance.threshold', 'advance', 'threshold', SELECT_THRESHOLD, { phase: 2 }),
  available('advance.bottom_n', 'advance', 'bottom_n', SELECT_BOTTOM_N, { phase: 2 }),
  available('advance.manual_list', 'advance', 'manual_list', SELECT_MANUAL_LIST, { phase: 2 }),
];

function unionOf(tag: string, entries: readonly ManifestEntry[], reservedTags?: readonly string[]): Spec {
  const variants = entries.map((entry) => ({ tag: entry.tag as string, spec: entry.spec as Spec }));
  return reservedTags ? { t: 'union', tag, variants, reservedTags } : { t: 'union', tag, variants };
}

const STAGE = obj(
  [
    req('key', KEY),
    req('name', LTEXT),
    req('participants', PARTICIPANTS),
    opt('groups', GROUPS),
    req('pairing', unionOf('kind', PAIRING_ENTRIES, RESERVED_PAIRING_TAGS)),
    req('series', SERIES),
    dflt('ruleset', RULESET, { kind: 'season_default' }),
    dflt('doubles', BOOL, false),
    dflt('players_per_match', int(MIN_PLAYERS_PER_MATCH, MAX_PLAYERS_PER_MATCH), 2),
    req('scoring', SCORING),
    dflt('rank', arr(unionOf('kind', RANK_ENTRIES), 0, MAX_RANK_STEPS), []),
    dflt('columns', arr(KEY, 0, MAX_COLUMNS), []),
    opt('constraints', arr(unionOf('kind', CONSTRAINT_ENTRIES), 0, MAX_CONSTRAINTS)),
    opt('calendar', STAGE_CALENDAR),
    opt('end_when', END_WHEN),
    opt('foreach_group', FOREACH_GROUP),
  ],
  RESERVED_STAGE_FIELDS,
);

const EDGE = obj([
  req('key', KEY),
  req('from', KEY),
  req('to', KEY),
  req('select', arr(unionOf('kind', SELECT_ENTRIES), 1, MAX_SELECTS)),
  dflt('seeding', oneOf('rank', 'cross_group', 'random', 'manual'), 'rank'),
  dflt('gate', oneOf('admin_confirm', 'auto'), 'admin_confirm'),
]);

const ENTRY_BY_KIND: ReadonlyMap<PrimitiveKind, ManifestEntry> = new Map<PrimitiveKind, ManifestEntry>(
  [
    available('stage.define', 'stage', null, STAGE),
    available('group.form', 'group', null, GROUPS, { phase: 2 }),
    ...PAIRING_ENTRIES,
    available('series.rule', 'series', null, SERIES),
    available('team.ruleset', 'ruleset', null, RULESET),
    available('score.match', 'scoring', null, SCORING),
    ...RANK_ENTRIES,
    available('standings.view', 'standings', null, STANDINGS_VIEW, { phase: 2 }),
    available('advance.rule', 'advance', null, EDGE),
    ...SELECT_ENTRIES,
    available('rule.custom', 'rule', 'rule.custom', RULE_CUSTOM, { level: 'honor' }),
    available('text.rules', 'text', null, TEXT_SECTION),
    available('theme.hint', 'theme', null, THEME),
    available('module.legacy', 'module', null, MODULE_LEGACY),
    available('attr.define', 'attribute', null, ATTRIBUTE_DEF, { phase: 3 }),
    available('attr.assign', 'assign', null, ATTR_ASSIGN, { phase: 3 }),
    available('domain.define', 'domain', null, DOMAIN_DEF, { phase: 3 }),
    available('relation.define', 'relation', null, RELATION_DEF, { phase: 3 }),
    available('resource.define', 'resource', null, RESOURCE_DEF, { phase: 3 }),
    available('metric.define', 'metric', 'metric.define', METRIC_DEFINE, { phase: 3 }),
    available('rule.on_event', 'rule', 'rule.on_event', RULE_ON_EVENT, { phase: 3 }),
    available('effect.apply', 'effect', null, EFFECT, { phase: 3 }),
    available('player.action', 'rule', 'player.action', PLAYER_ACTION, { phase: 3 }),
    available('track.progression', 'metric', 'track.progression', TRACK_PROGRESSION, { phase: 3 }),
    available('score.placement', 'metric', 'score.placement', SCORE_PLACEMENT, { phase: 3 }),
    available('check.assisted', 'rule', 'check.assisted', CHECK_ASSISTED, { level: 'checked', phase: 3 }),
    available('adjust.manual', 'rule', 'adjust.manual', ADJUST_MANUAL, { level: 'checked', phase: 3 }),
    ...CONSTRAINT_ENTRIES,
    available('time.schedule', 'calendar', null, STAGE_CALENDAR, { phase: 4 }),
    available('time.deadline_policy', 'deadline', null, DEADLINE_POLICY, { phase: 4 }),
    available('stage.end_when', 'end_when', null, END_WHEN, { phase: 4 }),
    available('stage.foreach_group', 'foreach_group', null, FOREACH_GROUP, { phase: 4 }),
    reservedEntry('acquire.draft', 4),
  ].map((entry): [PrimitiveKind, ManifestEntry] => [entry.kind, entry]),
);

/** Every kind in `PRIMITIVE_KINDS` order: the available ones first, then the reserved ones. */
export const MANIFEST: readonly ManifestEntry[] = deepFreeze(
  PRIMITIVE_KINDS.map((kind) => {
    const entry = ENTRY_BY_KIND.get(kind);
    if (!entry) throw new Error(`manifest entry missing for ${kind}`);
    return entry;
  }),
);

/** The entry of a kind, or undefined for a name that is not a primitive kind. */
export function manifestEntry(kind: string): ManifestEntry | undefined {
  return ENTRY_BY_KIND.get(kind as PrimitiveKind);
}

/** The entries of one slot, in manifest order. */
export function manifestForSlot(slot: ManifestSlot): readonly ManifestEntry[] {
  return MANIFEST.filter((entry) => entry.slot === slot);
}

/** The Spec of an available kind; throws for a reserved or unknown kind (a programming error). */
export function specOf(kind: AvailableKind): Spec {
  const spec = ENTRY_BY_KIND.get(kind)?.spec;
  if (!spec) throw new Error(`no spec for ${kind}`);
  return spec;
}

/** The Spec of one `tunables` entry (a tunable has no kind of its own). */
export function tunableSpec(): Spec {
  return TUNABLE_DEF;
}

export { AVAILABLE_KINDS, RESERVED_KINDS };
export type { AvailableKind, PrimitiveKind, ReservedKind };
