/**
 * The primitive manifest: one plain-data entry per kind (available and reserved) and the Spec of
 * every available kind. It is the single data source for the browser validator (`DOCUMENT_SPEC` is
 * built from it) and for the Studio forms later; the server twin is `server.ts` (zod params
 * schemas, one per available kind).
 *
 * Levels state the INTENDED enforcement of a primitive ("auto" the engine runs it, "checked" an
 * admin confirms a computed result, "honor" a rule card nobody enforces). Nothing executes in this
 * release; the badge is metadata. Reserved kinds are listed so a document that names them fails
 * with `not_available_yet`.
 *
 * Adding a primitive: one entry here, its zod params schema in `schema/primitives.ts`, its
 * describe function in `describe.ts`, its catalog keys in `format-studio/primitives`, and tests.
 *
 * Zero zod, no server-only import.
 */
import { deepFreeze } from '@/lib/studio-core/json';
import {
  MAX_BEST_OF,
  MAX_COLUMNS,
  MAX_EXPECTED_COUNT,
  MAX_FACTS,
  MAX_GROUPS,
  MAX_LEGS,
  MAX_N,
  MAX_N_PER_GROUP,
  MAX_OVERRIDE_ROUND,
  MAX_OVERRIDES,
  MAX_PLAYERS_PER_MATCH,
  MAX_RANK_STEPS,
  MAX_SELECTS,
  MAX_SWISS_ROUNDS,
  MAX_VIEW_STAGES,
  MIN_GROUPS,
  MIN_PLAYERS_PER_MATCH,
  SCORE_ABS_MAX,
} from '../limits';
import { LTEXT_MAX_CHARS } from '@/lib/studio-core/ltext';
import {
  AVAILABLE_KINDS,
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
export const RESERVED_SECTIONS = ['attributes', 'domains', 'relations', 'resources', 'metrics', 'tunables'] as const;
/** Stage fields that are reserved for later phases. */
export const RESERVED_STAGE_FIELDS = ['constraints', 'acquire', 'calendar', 'end_when', 'foreach_group'] as const;
/** Pairing kinds (the tag after `pairing.`) that are reserved for later phases. */
export const RESERVED_PAIRING_TAGS = ['bipartite', 'filter', 'challenge'] as const;
/** Rule kinds that are reserved for later phases. */
export const RESERVED_RULE_KINDS = ['rule.on_event', 'player.action', 'check.assisted', 'adjust.manual'] as const;

/**
 * Reserved kinds that are neither a pairing tag nor a rule kind, with the document field (or rule
 * kind) that will carry them. `tunables` has no kind of its own.
 */
export const RESERVED_KIND_OWNERS: ReadonlyMap<ReservedKind, string> = new Map<ReservedKind, string>([
  ['attr.define', 'attributes'],
  ['domain.define', 'domains'],
  ['attr.assign', 'attributes'],
  ['relation.define', 'relations'],
  ['resource.define', 'resources'],
  ['metric.define', 'metrics'],
  ['effect.apply', 'rule.on_event'],
  ['track.progression', 'metrics'],
  ['score.placement', 'metrics'],
  ['constraint.type_quota', 'constraints'],
  ['constraint.tera', 'constraints'],
  ['constraint.evolution_stage', 'constraints'],
  ['constraint.count', 'constraints'],
  ['constraint.distinct', 'constraints'],
  ['constraint.roster_size', 'constraints'],
  ['acquire.draft', 'acquire'],
  ['time.schedule', 'calendar'],
  ['time.deadline_policy', 'calendar'],
  ['stage.end_when', 'end_when'],
  ['stage.foreach_group', 'foreach_group'],
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
const SCORING = obj([
  req('win', SCORE_NUM),
  dflt('loss', SCORE_NUM, 0),
  dflt('bye', SCORE_NUM, 0),
  opt('draw', SCORE_NUM),
  opt('forfeit', SCORE_NUM),
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
    reservedEntry('attr.define', 3),
    reservedEntry('domain.define', 3),
    reservedEntry('attr.assign', 3),
    reservedEntry('relation.define', 3),
    reservedEntry('resource.define', 3),
    reservedEntry('metric.define', 3),
    reservedEntry('rule.on_event', 3),
    reservedEntry('player.action', 3),
    reservedEntry('effect.apply', 3),
    reservedEntry('track.progression', 3),
    reservedEntry('score.placement', 3),
    reservedEntry('pairing.bipartite', 4),
    reservedEntry('pairing.filter', 4),
    reservedEntry('pairing.challenge', 4),
    reservedEntry('constraint.type_quota', 4),
    reservedEntry('constraint.tera', 4),
    reservedEntry('constraint.evolution_stage', 4),
    reservedEntry('constraint.count', 4),
    reservedEntry('constraint.distinct', 4),
    reservedEntry('constraint.roster_size', 4),
    reservedEntry('acquire.draft', 4),
    reservedEntry('check.assisted', 3),
    reservedEntry('adjust.manual', 3),
    reservedEntry('time.schedule', 4),
    reservedEntry('time.deadline_policy', 4),
    reservedEntry('stage.end_when', 4),
    reservedEntry('stage.foreach_group', 4),
  ].map((entry): [PrimitiveKind, ManifestEntry] => [entry.kind, entry]),
);

/** Every kind in `PRIMITIVE_KINDS` order: the 27 available ones first, then the reserved ones. */
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

export { AVAILABLE_KINDS, RESERVED_KINDS };
export type { AvailableKind, PrimitiveKind, ReservedKind };
